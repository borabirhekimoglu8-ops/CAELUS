//! Bounded Blake3 helper for offline neural training/export tooling.

use std::env;
use std::fs::OpenOptions;
use std::io::Read;
use std::path::Path;

#[cfg(unix)]
use std::os::unix::fs::OpenOptionsExt;

const MAX_ARTIFACT_BYTES: u64 = 64 * 1024 * 1024;

fn hash_reader(mut reader: impl Read) -> Result<(u64, String), String> {
    let mut hasher = blake3::Hasher::new();
    let mut buffer = [0u8; 64 * 1024];
    let mut total = 0u64;
    loop {
        let read = reader
            .read(&mut buffer)
            .map_err(|error| format!("cannot read artifact: {error}"))?;
        if read == 0 {
            break;
        }
        total = total
            .checked_add(read as u64)
            .ok_or("artifact length overflow")?;
        if total > MAX_ARTIFACT_BYTES {
            return Err("artifact grew beyond size limit while hashing".into());
        }
        hasher.update(&buffer[..read]);
    }
    if total == 0 {
        return Err("artifact must not be empty".into());
    }
    Ok((total, hasher.finalize().to_hex().to_string()))
}

fn hash_file(path: &Path) -> Result<(u64, String), String> {
    let path_metadata = std::fs::symlink_metadata(path)
        .map_err(|error| format!("cannot stat {}: {error}", path.display()))?;
    if path_metadata.file_type().is_symlink() {
        return Err("refusing to hash a symbolic link".into());
    }
    if !path_metadata.file_type().is_file() {
        return Err("artifact must be a regular file".into());
    }
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    options.custom_flags(libc::O_NOFOLLOW);
    let mut file = options
        .open(path)
        .map_err(|error| format!("cannot open {}: {error}", path.display()))?;
    let metadata = file
        .metadata()
        .map_err(|error| format!("cannot stat {}: {error}", path.display()))?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > MAX_ARTIFACT_BYTES {
        return Err(format!(
            "artifact must be a non-empty regular file no larger than {MAX_ARTIFACT_BYTES} bytes"
        ));
    }
    let (total, hash) = hash_reader(&mut file)?;
    if total != metadata.len() {
        return Err("artifact changed while hashing".into());
    }
    Ok((total, hash))
}

fn main() {
    let mut args = env::args().skip(1);
    let Some(source) = args.next() else {
        eprintln!("Usage: caelus_neural_hash <artifact|--stdin>");
        std::process::exit(2);
    };
    if args.next().is_some() {
        eprintln!("exactly one artifact path is required");
        std::process::exit(2);
    }
    let result = if source == "--stdin" {
        hash_reader(std::io::stdin().lock())
    } else {
        hash_file(Path::new(&source))
    };
    match result {
        Ok((size, hash)) => println!("{hash} {size}"),
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
    fn empty_file_is_rejected() {
        let path =
            env::temp_dir().join(format!("caelus-neural-empty-{}-{}", std::process::id(), 17));
        std::fs::write(&path, []).unwrap();
        assert!(hash_file(&path).is_err());
        std::fs::remove_file(path).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn symbolic_link_is_rejected() {
        use std::os::unix::fs::symlink;

        let base = env::temp_dir().join(format!(
            "caelus-neural-hash-link-{}-{}",
            std::process::id(),
            23
        ));
        let target = base.with_extension("target");
        let link = base.with_extension("link");
        std::fs::write(&target, b"artifact").unwrap();
        symlink(&target, &link).unwrap();
        assert!(hash_file(&link).is_err());
        std::fs::remove_file(link).unwrap();
        std::fs::remove_file(target).unwrap();
    }
}
