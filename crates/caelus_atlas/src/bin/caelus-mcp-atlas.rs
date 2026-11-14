//! Stdio `rmcp` MCP Server binary for `caelus_atlas` (`caelus-mcp-atlas`).

use caelus_atlas::mcp_bridge::handle_mcp_jsonrpc_line;
use caelus_atlas::LivingAtlas;
use std::io::{self, BufRead, Write};
use std::path::PathBuf;
use std::process;

fn main() {
    let mut mmap_dir: Option<PathBuf> = None;
    let mut zero_copy_rkyv = false;
    let mut self_test = false;

    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--mmap-dir" => {
                if let Some(p) = args.next() {
                    mmap_dir = Some(PathBuf::from(p));
                }
            }
            "--zero-copy-rkyv" => {
                zero_copy_rkyv = true;
            }
            "--self-test" => {
                self_test = true;
            }
            "--help" | "-h" => {
                println!(
                    "Usage: caelus-mcp-atlas [--mmap-dir <dir>] [--zero-copy-rkyv] [--self-test]"
                );
                return;
            }
            other => {
                eprintln!("Unknown argument: {other}");
                process::exit(2);
            }
        }
    }
    let _ = zero_copy_rkyv;

    let atlas = match mmap_dir {
        Some(ref dir) => LivingAtlas::open_readonly(dir),
        None => LivingAtlas::open_default_readonly(),
    };
    let atlas = match atlas {
        Ok(a) => a,
        Err(err) => {
            eprintln!("caelus-mcp-atlas mount failed: {err}");
            process::exit(1);
        }
    };

    if self_test {
        let imo = atlas
            .store()
            .sample_vessel_imos(1)
            .into_iter()
            .next()
            .unwrap_or(9552070);
        let probes = [
            r#"{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}"#.to_string(),
            format!(
                r#"{{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{{"name":"atlas_leap_lookup","arguments":{{"query":"IMO{imo}"}}}}}}"#
            ),
            format!(
                r#"{{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{{"name":"atlas_evaluate_four_gates","arguments":{{"imo":{imo},"origin_unlocode":"TRSEF","dest_unlocode":"GRSMI"}}}}}}"#
            ),
            r#"{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"atlas_delta_status","arguments":{}}}"#.to_string(),
        ];
        for req in probes {
            match handle_mcp_jsonrpc_line(&atlas, &req) {
                Some(resp) => println!("{resp}"),
                None => {
                    eprintln!("self-test probe produced no response");
                    process::exit(1);
                }
            }
        }
        return;
    }

    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut out = io::BufWriter::new(stdout.lock());
    for line_res in stdin.lock().lines() {
        let Ok(line) = line_res else {
            break;
        };
        if line.trim().is_empty() {
            continue;
        }
        if let Some(resp) = handle_mcp_jsonrpc_line(&atlas, &line) {
            if writeln!(out, "{resp}").is_err() || out.flush().is_err() {
                break;
            }
        }
    }
}
