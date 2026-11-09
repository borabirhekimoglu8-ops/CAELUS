//! Offline signer for CAELUS deterministic neural model packages.
//!
//! The private seed is read from a repository-external file and zeroized on
//! drop.  The output sidecar contains only public material:
//! `ed25519:<public-key-hex>:<signature-hex>`.

use std::env;
use std::fs::OpenOptions;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use caelus_network::model_verify::{
    neural_model_public_key, sign_neural_model_hashes, MAX_HASH_INPUT_BYTES,
};
use zeroize::Zeroizing;

fn usage() -> &'static str {
    "Usage:\n\
  caelus_sign_model --manifest <manifest.json> --weights <weights.bin> \\\n      --key </secure/offline/neural_signing.key> [--output <model.sig>] [--write]\n\
  caelus_sign_model --key </secure/offline/neural_signing.key> --print-public-key\n\
\n\
The key file must contain exactly 32 raw bytes or 64 hexadecimal characters.\n\
Without --write, the signature sidecar is printed to stdout."
}

fn hex_nibble(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(10 + byte - b'a'),
        b'A'..=b'F' => Some(10 + byte - b'A'),
        _ => None,
    }
}

fn decode_seed(bytes: &[u8]) -> Result<[u8; 32], String> {
    if bytes.len() == 32 {
        return bytes.try_into().map_err(|_| "invalid seed length".into());
    }
    let trimmed = bytes
        .strip_suffix(b"\r\n")
        .or_else(|| bytes.strip_suffix(b"\n"))
        .unwrap_or(bytes);
    if trimmed.len() != 64 {
        return Err("key must be 32 raw bytes or 64 hex characters".into());
    }
    let mut out = [0u8; 32];
    for (index, chunk) in trimmed.chunks_exact(2).enumerate() {
        let hi = hex_nibble(chunk[0]).ok_or_else(|| "key contains non-hex byte".to_string())?;
        let lo = hex_nibble(chunk[1]).ok_or_else(|| "key contains non-hex byte".to_string())?;
        out[index] = (hi << 4) | lo;
    }
    Ok(out)
}

fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for &byte in bytes {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0x0f) as usize] as char);
    }
    out
}

fn reject_symbolic_link(path: &Path, label: &str) -> Result<(), String> {
    let metadata = std::fs::symlink_metadata(path)
        .map_err(|error| format!("cannot stat {label} {path:?}: {error}"))?;
    if metadata.file_type().is_symlink() {
        return Err(format!("{label} must not be a symbolic link: {path:?}"));
    }
    if !metadata.file_type().is_file() {
        return Err(format!("{label} must be a regular file: {path:?}"));
    }
    Ok(())
}

fn read_bounded(path: &Path, label: &str) -> Result<Vec<u8>, String> {
    reject_symbolic_link(path, label)?;
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    let file = options
        .open(path)
        .map_err(|error| format!("cannot open {label} {path:?}: {error}"))?;
    let metadata = file
        .metadata()
        .map_err(|error| format!("cannot stat open {label} {path:?}: {error}"))?;
    if !metadata.is_file() {
        return Err(format!(
            "{label} must be a regular non-symlink file: {path:?}"
        ));
    }
    if metadata.len() == 0 {
        return Err(format!("{label} is empty: {path:?}"));
    }
    if metadata.len() > MAX_HASH_INPUT_BYTES as u64 {
        return Err(format!(
            "{label} exceeds {} byte limit: {}",
            MAX_HASH_INPUT_BYTES,
            metadata.len()
        ));
    }
    let mut data = Vec::with_capacity(metadata.len() as usize);
    file.take(MAX_HASH_INPUT_BYTES as u64 + 1)
        .read_to_end(&mut data)
        .map_err(|error| format!("cannot read {label} {path:?}: {error}"))?;
    if data.len() as u64 != metadata.len() {
        return Err(format!("{label} changed while being read: {path:?}"));
    }
    Ok(data)
}

fn read_private_key(path: &Path) -> Result<Zeroizing<Vec<u8>>, String> {
    reject_symbolic_link(path, "private key")?;
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    let file = options
        .open(path)
        .map_err(|error| format!("cannot open private key {path:?}: {error}"))?;
    let metadata = file
        .metadata()
        .map_err(|error| format!("cannot stat open private key {path:?}: {error}"))?;
    if !metadata.is_file() {
        return Err(format!(
            "private key must be a regular non-symlink file: {path:?}"
        ));
    }
    if metadata.len() == 0 || metadata.len() > 66 {
        return Err(format!(
            "private key file has invalid size: {}",
            metadata.len()
        ));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if metadata.permissions().mode() & 0o077 != 0 {
            return Err("private key permissions must not grant group/other access".into());
        }
    }
    let mut data = Zeroizing::new(Vec::with_capacity(metadata.len() as usize));
    file.take(67)
        .read_to_end(&mut data)
        .map_err(|error| format!("cannot read private key {path:?}: {error}"))?;
    if data.len() as u64 != metadata.len() {
        return Err("private key changed while being read".into());
    }
    Ok(data)
}

#[derive(Debug)]
struct Args {
    manifest: Option<PathBuf>,
    weights: Option<PathBuf>,
    key: PathBuf,
    output: Option<PathBuf>,
    write: bool,
    print_public_key: bool,
}

fn parse_args(mut args: impl Iterator<Item = String>) -> Result<Args, String> {
    let mut manifest = None;
    let mut weights = None;
    let mut key = None;
    let mut output = None;
    let mut write = false;
    let mut print_public_key = false;
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--manifest" => manifest = args.next().map(PathBuf::from),
            "--weights" => weights = args.next().map(PathBuf::from),
            "--key" => key = args.next().map(PathBuf::from),
            "--output" => output = args.next().map(PathBuf::from),
            "--write" => write = true,
            "--print-public-key" => print_public_key = true,
            "--help" | "-h" => return Err(usage().into()),
            other => return Err(format!("unknown argument: {other}\n{}", usage())),
        }
    }
    if !print_public_key && (manifest.is_none() || weights.is_none()) {
        return Err(format!(
            "--manifest and --weights are required when signing\n{}",
            usage()
        ));
    }
    if print_public_key && (manifest.is_some() || weights.is_some() || output.is_some() || write) {
        return Err("--print-public-key cannot be combined with signing options".into());
    }
    Ok(Args {
        manifest,
        weights,
        key: key.ok_or_else(|| format!("--key is required\n{}", usage()))?,
        output,
        write,
        print_public_key,
    })
}

fn run(args: Args) -> Result<(), String> {
    let key_bytes = read_private_key(&args.key)?;
    let seed = Zeroizing::new(decode_seed(&key_bytes)?);
    if args.print_public_key {
        println!("{}", hex_encode(&neural_model_public_key(&seed)));
        return Ok(());
    }
    let manifest_path = args
        .manifest
        .as_ref()
        .ok_or("internal error: manifest path absent")?;
    let weights_path = args
        .weights
        .as_ref()
        .ok_or("internal error: weights path absent")?;
    let manifest = read_bounded(manifest_path, "manifest")?;
    let weights = read_bounded(weights_path, "weights")?;

    let manifest_hash = *blake3::hash(&manifest).as_bytes();
    let weights_hash = *blake3::hash(&weights).as_bytes();
    let (signature, public_key) = sign_neural_model_hashes(&manifest_hash, &weights_hash, &seed);
    let sidecar = format!(
        "ed25519:{}:{}\n",
        hex_encode(&public_key),
        hex_encode(&signature)
    );

    if args.write {
        let output = args
            .output
            .unwrap_or_else(|| manifest_path.with_file_name("model.sig"));
        // create_new prevents following or truncating an existing symlink and
        // requires the operator to make replacement explicit.
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&output)
            .map_err(|error| {
                format!("cannot create new signature {output:?} (refusing overwrite): {error}")
            })?;
        file.write_all(sidecar.as_bytes())
            .and_then(|_| file.sync_all())
            .map_err(|error| format!("cannot write signature {output:?}: {error}"))?;
        eprintln!(
            "signed neural model: manifest_hash={} weights_hash={} output={}",
            hex_encode(&manifest_hash),
            hex_encode(&weights_hash),
            output.display()
        );
    } else {
        print!("{sidecar}");
    }
    Ok(())
}

fn main() {
    match parse_args(env::args().skip(1)).and_then(run) {
        Ok(()) => {}
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(2);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seed_parser_accepts_raw_and_hex() {
        assert_eq!(decode_seed(&[7u8; 32]).unwrap(), [7u8; 32]);
        let text = "42".repeat(32);
        assert_eq!(decode_seed(text.as_bytes()).unwrap(), [0x42u8; 32]);
        assert!(decode_seed(b"short").is_err());
    }

    #[test]
    fn signature_sidecar_shape_is_deterministic() {
        let manifest = *blake3::hash(b"manifest").as_bytes();
        let weights = *blake3::hash(b"weights").as_bytes();
        let (signature_a, public_a) = sign_neural_model_hashes(&manifest, &weights, &[9u8; 32]);
        let (signature_b, public_b) = sign_neural_model_hashes(&manifest, &weights, &[9u8; 32]);
        assert_eq!(signature_a, signature_b);
        assert_eq!(public_a, public_b);
        assert_eq!(hex_encode(&signature_a).len(), 128);
        assert_eq!(hex_encode(&public_a).len(), 64);
    }

    #[test]
    fn public_key_derivation_matches_signing_path() {
        let seed = [0x33u8; 32];
        let (_, signed_public) = sign_neural_model_hashes(&[0; 32], &[0; 32], &seed);
        assert_eq!(neural_model_public_key(&seed), signed_public);
    }
}
