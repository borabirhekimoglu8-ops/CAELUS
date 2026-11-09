use calamine::{open_workbook_auto, Data, Reader};
use rust_xlsxwriter::{Format, Workbook};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::env;
use std::fs;
use std::path::Path;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CellRecord {
    pub row_1based: usize,
    pub col_1based: usize,
    pub cell_ref: String,
    pub raw_type: String,
    pub display_value: String,
    pub numeric_value: Option<f64>,
    pub has_formula: bool,
    pub formula_expression: Option<String>,
    pub cached_value: Option<String>,
    pub formula_status: String, // "LITERAL_VALUE" | "FORMULA_WITH_CACHED_VALUE" | "FORMULA_UNCOMPUTED"
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SheetRecord {
    pub sheet_name: String,
    pub row_count: usize,
    pub col_count: usize,
    pub headers: Vec<String>,
    pub rows: Vec<Vec<CellRecord>>,
    pub formula_cell_count: usize,
    pub cached_formula_count: usize,
    pub uncomputed_formula_count: usize,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CalamineReadReport {
    pub ok: bool,
    pub engine: String,
    pub engine_version: String,
    pub source_file: String,
    pub source_hash_sha256: String,
    pub file_size_bytes: u64,
    pub has_vba_macro: bool,
    pub macro_policy: String,
    pub warnings: Vec<String>,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
    pub sheet_names: Vec<String>,
    pub sheets: Vec<SheetRecord>,
}

fn col_to_letter(mut col_1based: usize) -> String {
    let mut out = String::new();
    while col_1based > 0 {
        let rem = (col_1based - 1) % 26;
        out.insert(0, (b'A' + rem as u8) as char);
        col_1based = (col_1based - 1) / 26;
    }
    out
}

fn sanitize_spreadsheet_cell(val: &str) -> String {
    if let Some(first) = val.chars().next() {
        if matches!(first, '=' | '+' | '-' | '@' | '\t' | '\r') {
            return format!("'{}", val);
        }
    }
    val.to_string()
}

fn read_xlsx_with_calamine(file_path: &Path) -> CalamineReadReport {
    let source_name = file_path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| file_path.to_string_lossy().to_string());

    let bytes = match fs::read(file_path) {
        Ok(b) => b,
        Err(e) => {
            return CalamineReadReport {
                ok: false,
                engine: "calamine".to_string(),
                engine_version: "0.38.0".to_string(),
                source_file: source_name,
                source_hash_sha256: String::new(),
                file_size_bytes: 0,
                has_vba_macro: false,
                macro_policy: "NEVER_EXECUTE_MACROS".to_string(),
                warnings: vec![],
                error_code: Some("FILE_IO_ERROR".to_string()),
                error_message: Some(format!("Dosya okunamadı: {}", e)),
                sheet_names: vec![],
                sheets: vec![],
            };
        }
    };

    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    let sha_hex = format!("{:x}", hasher.finalize());
    let file_size = bytes.len() as u64;

    // Detect vbaProject.bin inside ZIP stream without ever executing macros
    let has_vba_bytes = bytes
        .windows(b"vbaProject.bin".len())
        .any(|w| w == b"vbaProject.bin");

    let mut workbook = match open_workbook_auto(file_path) {
        Ok(wb) => wb,
        Err(e) => {
            return CalamineReadReport {
                ok: false,
                engine: "calamine".to_string(),
                engine_version: "0.38.0".to_string(),
                source_file: source_name,
                source_hash_sha256: sha_hex,
                file_size_bytes: file_size,
                has_vba_macro: has_vba_bytes,
                macro_policy: "NEVER_EXECUTE_MACROS".to_string(),
                warnings: vec![],
                error_code: Some("CORRUPT_OR_UNSUPPORTED_WORKBOOK".to_string()),
                error_message: Some(format!(
                    "Tablo dosyası bozuk veya desteklenmeyen yapıda: {}",
                    e
                )),
                sheet_names: vec![],
                sheets: vec![],
            };
        }
    };

    let has_vba = has_vba_bytes || matches!(workbook.vba_project(), Ok(Some(_)));
    let mut warnings = Vec::new();
    if has_vba {
        warnings.push(
            "MAKRO_UYARISI: Dosyada VBA makrosu (vbaProject.bin) tespit edildi. CAELUS güvenlik politikası gereği makrolar kesinlikle çalıştırılmaz; yalnızca statik tablo hücreleri güvenli okuma modunda alındı."
                .to_string(),
        );
    }

    let sheet_names = workbook.sheet_names().to_vec();
    let mut sheets = Vec::new();

    for s_name in &sheet_names {
        let range = match workbook.worksheet_range(s_name) {
            Ok(r) => r,
            Err(e) => {
                warnings.push(format!("Sayfa '{}' okunurken uyarı: {}", s_name, e));
                continue;
            }
        };

        let (range_start_r, range_start_c) = range.start().unwrap_or((0, 0));
        let mut formula_map: HashMap<(u32, u32), String> = HashMap::new();
        if let Ok(f_range) = workbook.worksheet_formula(s_name) {
            let (f_start_r, f_start_c) = f_range.start().unwrap_or((0, 0));
            for (r, c, f_str) in f_range.used_cells() {
                if !f_str.trim().is_empty() {
                    let expr = if f_str.starts_with('=') {
                        f_str.to_string()
                    } else {
                        format!("={}", f_str)
                    };
                    let abs_r = f_start_r + (r as u32) - range_start_r;
                    let abs_c = f_start_c + (c as u32) - range_start_c;
                    formula_map.insert((abs_r, abs_c), expr);
                }
            }
        }

        let (height, width) = range.get_size();
        let mut headers = Vec::new();
        let mut rows = Vec::new();
        let mut formula_cell_count = 0usize;
        let mut cached_formula_count = 0usize;
        let mut uncomputed_formula_count = 0usize;

        for r_idx in 0..height {
            let mut row_cells = Vec::new();
            for c_idx in 0..width {
                let cell_val = range.get_value((r_idx as u32, c_idx as u32));
                let formula_opt = formula_map.get(&(r_idx as u32, c_idx as u32)).cloned();
                let has_formula = formula_opt.is_some();

                let (raw_type, display_value, numeric_value, is_empty) = match cell_val {
                    Some(Data::String(s)) => ("String".to_string(), s.clone(), s.parse::<f64>().ok(), s.is_empty()),
                    Some(Data::Float(f)) => ("Float".to_string(), format!("{}", f), Some(*f), false),
                    Some(Data::Int(i)) => ("Int".to_string(), format!("{}", i), Some(*i as f64), false),
                    Some(Data::Bool(b)) => ("Bool".to_string(), format!("{}", b), None, false),
                    Some(Data::DateTime(dt)) => ("DateTime".to_string(), format!("{}", dt), None, false),
                    Some(Data::DateTimeIso(s)) => ("DateTimeIso".to_string(), s.clone(), None, false),
                    Some(Data::DurationIso(s)) => ("DurationIso".to_string(), s.clone(), None, false),
                    Some(Data::Error(err)) => ("FormulaError".to_string(), format!("{:?}", err), None, false),
                    Some(Data::Empty) | None => ("Empty".to_string(), String::new(), None, true),
                };

                let (cached_value, formula_status) = if has_formula {
                    formula_cell_count += 1;
                    if is_empty {
                        uncomputed_formula_count += 1;
                        (None, "FORMULA_UNCOMPUTED".to_string())
                    } else {
                        cached_formula_count += 1;
                        (Some(display_value.clone()), "FORMULA_WITH_CACHED_VALUE".to_string())
                    }
                } else {
                    (None, "LITERAL_VALUE".to_string())
                };

                if r_idx == 0 {
                    headers.push(display_value.clone());
                }

                let cell_ref = format!("{}{}", col_to_letter(c_idx + 1), r_idx + 1);
                row_cells.push(CellRecord {
                    row_1based: r_idx + 1,
                    col_1based: c_idx + 1,
                    cell_ref,
                    raw_type,
                    display_value,
                    numeric_value,
                    has_formula,
                    formula_expression: formula_opt,
                    cached_value,
                    formula_status,
                });
            }
            rows.push(row_cells);
        }

        if uncomputed_formula_count > 0 {
            warnings.push(format!(
                "Sayfa '{}' içinde {} adet formüllü hücrenin önbellekli (cached) sonucu bulunmuyor; CAELUS bu hücreleri hesaplanmış değer olarak varsaymaz ve açıkça işaretler.",
                s_name, uncomputed_formula_count
            ));
        }

        sheets.push(SheetRecord {
            sheet_name: s_name.clone(),
            row_count: height,
            col_count: width,
            headers,
            rows,
            formula_cell_count,
            cached_formula_count,
            uncomputed_formula_count,
        });
    }

    CalamineReadReport {
        ok: true,
        engine: "calamine".to_string(),
        engine_version: "0.38.0".to_string(),
        source_file: source_name,
        source_hash_sha256: sha_hex,
        file_size_bytes: file_size,
        has_vba_macro: has_vba,
        macro_policy: if has_vba {
            "MACRO_DETECTED_STRIPPED_READ_ONLY".to_string()
        } else {
            "NO_MACRO_SAFE_READ".to_string()
        },
        warnings,
        error_code: None,
        error_message: None,
        sheet_names,
        sheets,
    }
}

fn write_sheet_table(
    workbook: &mut Workbook,
    sheet_title: &str,
    headers: &[&str],
    rows: &[Vec<String>],
) -> Result<(), String> {
    let worksheet = workbook.add_worksheet();
    worksheet
        .set_name(sheet_title)
        .map_err(|e| format!("Sayfa adı hatası ({}): {}", sheet_title, e))?;

    let header_fmt = Format::new().set_bold();
    for (col_idx, h) in headers.iter().enumerate() {
        worksheet
            .write_string_with_format(0, col_idx as u16, *h, &header_fmt)
            .map_err(|e| e.to_string())?;
        worksheet.set_column_width(col_idx as u16, 24).ok();
    }

    for (row_idx, row) in rows.iter().enumerate() {
        let excel_row = (row_idx + 1) as u32;
        for (col_idx, cell_val) in row.iter().enumerate() {
            let safe_val = sanitize_spreadsheet_cell(cell_val);
            worksheet
                .write_string(excel_row, col_idx as u16, &safe_val)
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn export_xlsx_report(spec_path: &Path, out_xlsx_path: &Path) -> Result<Value, String> {
    let raw_spec = fs::read_to_string(spec_path)
        .map_err(|e| format!("Rapor girdi JSON dosyası okunamadı: {}", e))?;
    let spec: Value = serde_json::from_str(&raw_spec)
        .map_err(|e| format!("Rapor girdi JSON ayrıştırılamadı: {}", e))?;

    let mut workbook = Workbook::new();

    // 1. Özet
    let summary_rows: Vec<Vec<String>> = spec["sheets"]["Ozet"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .map(|r| {
                    vec![
                        r["alan"].as_str().unwrap_or("").to_string(),
                        r["deger"].as_str().unwrap_or("").to_string(),
                        r["aciklama"].as_str().unwrap_or("").to_string(),
                    ]
                })
                .collect()
        })
        .unwrap_or_default();
    write_sheet_table(
        &mut workbook,
        "Özet",
        &["Alan", "Değer", "Açıklama ve Epistemik Durum"],
        &summary_rows,
    )?;

    // 2. Varlıklar
    let entity_rows: Vec<Vec<String>> = spec["sheets"]["Varliklar"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .map(|r| {
                    vec![
                        r["entity_id"].as_str().unwrap_or("").to_string(),
                        r["entity_name"].as_str().unwrap_or("").to_string(),
                        r["entity_type"].as_str().unwrap_or("").to_string(),
                        r["epistemic_status"].as_str().unwrap_or("").to_string(),
                        r["dedup_decision"].as_str().unwrap_or("").to_string(),
                        r["source_file"].as_str().unwrap_or("").to_string(),
                        r["source_sheet"].as_str().unwrap_or("").to_string(),
                        r["source_rows"].as_str().unwrap_or("").to_string(),
                    ]
                })
                .collect()
        })
        .unwrap_or_default();
    write_sheet_table(
        &mut workbook,
        "Varlıklar",
        &[
            "Varlık Kimliği",
            "Varlık Adı",
            "Varlık Türü",
            "Bilgi Sınıfı",
            "Tekilleştirme Kararı",
            "Kaynak Dosya",
            "Kaynak Sayfa",
            "Kaynak Satırlar",
        ],
        &entity_rows,
    )?;

    // 3. İlişkiler
    let rel_rows: Vec<Vec<String>> = spec["sheets"]["Iliskiler"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .map(|r| {
                    vec![
                        r["relation_id"].as_str().unwrap_or("").to_string(),
                        r["from_entity"].as_str().unwrap_or("").to_string(),
                        r["to_entity"].as_str().unwrap_or("").to_string(),
                        r["relation_type"].as_str().unwrap_or("").to_string(),
                        r["weight"].as_str().unwrap_or("").to_string(),
                        r["unit_value"].as_str().unwrap_or("").to_string(),
                        r["occurred_at"].as_str().unwrap_or("").to_string(),
                        r["source_trace"].as_str().unwrap_or("").to_string(),
                    ]
                })
                .collect()
        })
        .unwrap_or_default();
    write_sheet_table(
        &mut workbook,
        "İlişkiler",
        &[
            "İlişki Kimliği",
            "Kaynak Varlık",
            "Hedef Varlık",
            "İlişki Türü",
            "Kritiklik / Ağırlık",
            "Hacim ve Birim",
            "Olay Zamanı (occurred_at)",
            "Kaynak İzi (Dosya#Sayfa:Satır)",
        ],
        &rel_rows,
    )?;

    // 4. Senaryo Karşılaştırması
    let scen_rows: Vec<Vec<String>> = spec["sheets"]["Senaryo_Karsilastirmasi"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .map(|r| {
                    vec![
                        r["option_id"].as_str().unwrap_or("").to_string(),
                        r["option_label"].as_str().unwrap_or("").to_string(),
                        r["target_node"].as_str().unwrap_or("").to_string(),
                        r["baseline_stress"].as_str().unwrap_or("").to_string(),
                        r["post_option_stress"].as_str().unwrap_or("").to_string(),
                        r["delta_stress"].as_str().unwrap_or("").to_string(),
                        r["epistemic_class"].as_str().unwrap_or("SIMULE_EDILEN").to_string(),
                        r["rationale"].as_str().unwrap_or("").to_string(),
                    ]
                })
                .collect()
        })
        .unwrap_or_default();
    write_sheet_table(
        &mut workbook,
        "Senaryo Karşılaştırması",
        &[
            "Seçenek Kodu",
            "Müdahale / Senaryo Seçeneği",
            "Hedef Düğüm",
            "Müdahalesiz Baskı",
            "Seçenek Sonrası Baskı",
            "Net Etki (Delta)",
            "Bilgi Sınıfı",
            "Dayanak ve Açıklama",
        ],
        &scen_rows,
    )?;

    // 5. Varsayımlar
    let assump_rows: Vec<Vec<String>> = spec["sheets"]["Varsayimlar"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .map(|r| {
                    vec![
                        r["assumption_id"].as_str().unwrap_or("").to_string(),
                        r["category"].as_str().unwrap_or("VARSAYILAN").to_string(),
                        r["statement"].as_str().unwrap_or("").to_string(),
                        r["impact_if_violated"].as_str().unwrap_or("").to_string(),
                    ]
                })
                .collect()
        })
        .unwrap_or_default();
    write_sheet_table(
        &mut workbook,
        "Varsayımlar",
        &[
            "Varsayım Kodu",
            "Epistemik Sınıf",
            "Varsayım Tanımı",
            "Varsayım Bozulursa Sonuca Etkisi",
        ],
        &assump_rows,
    )?;

    // 6. Hatalar ve Eksik Veriler
    let err_rows: Vec<Vec<String>> = spec["sheets"]["Hatalar_ve_Eksik_Veriler"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .map(|r| {
                    vec![
                        r["source_row"].as_str().unwrap_or("").to_string(),
                        r["column_name"].as_str().unwrap_or("").to_string(),
                        r["error_code"].as_str().unwrap_or("").to_string(),
                        r["reason_tr"].as_str().unwrap_or("").to_string(),
                        r["remediation_tr"].as_str().unwrap_or("").to_string(),
                    ]
                })
                .collect()
        })
        .unwrap_or_default();
    write_sheet_table(
        &mut workbook,
        "Hatalar ve Eksik Veriler",
        &[
            "Kaynak Satır",
            "Sütun Adı",
            "Hata / Eksiklik Kodu",
            "Sorun Açıklaması",
            "Düzeltme Önerisi",
        ],
        &err_rows,
    )?;

    // 7. Kaynak İzleri
    let trace_rows: Vec<Vec<String>> = spec["sheets"]["Kaynak_Izleri"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .map(|r| {
                    vec![
                        r["record_id"].as_str().unwrap_or("").to_string(),
                        r["source_file"].as_str().unwrap_or("").to_string(),
                        r["source_hash"].as_str().unwrap_or("").to_string(),
                        r["source_sheet"].as_str().unwrap_or("").to_string(),
                        r["source_row"].as_str().unwrap_or("").to_string(),
                        r["imported_at"].as_str().unwrap_or("").to_string(),
                        r["occurred_at"].as_str().unwrap_or("").to_string(),
                        r["learned_at"].as_str().unwrap_or("").to_string(),
                        r["mapping_method"].as_str().unwrap_or("").to_string(),
                        r["user_confirmation"].as_str().unwrap_or("").to_string(),
                    ]
                })
                .collect()
        })
        .unwrap_or_default();
    write_sheet_table(
        &mut workbook,
        "Kaynak İzleri",
        &[
            "Kayıt Kimliği",
            "Kaynak Dosya",
            "Kaynak Özeti (SHA-256)",
            "Kaynak Sayfa",
            "Kaynak Satır",
            "İçe Alım Zamanı (imported_at)",
            "Olay Zamanı (occurred_at)",
            "Öğrenilme Zamanı (learned_at)",
            "Eşleme Yöntemi",
            "Kullanıcı Onayı",
        ],
        &trace_rows,
    )?;

    workbook
        .save(out_xlsx_path)
        .map_err(|e| format!("XLSX kaydetme hatası: {}", e))?;

    let saved_bytes = fs::read(out_xlsx_path).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    hasher.update(&saved_bytes);
    let sha_hex = format!("{:x}", hasher.finalize());

    // Doğrulama: üretilen .xlsx dosyasını tekrar Calamine ile açıp 7 sayfanın okunabildiğini kanıtla
    let verify_report = read_xlsx_with_calamine(out_xlsx_path);

    Ok(json!({
        "ok": true,
        "engine": "rust_xlsxwriter",
        "engine_version": "0.79.4",
        "output_xlsx_path": out_xlsx_path.to_string_lossy(),
        "output_size_bytes": saved_bytes.len(),
        "output_sha256": sha_hex,
        "sheet_names": verify_report.sheet_names,
        "verified_by_calamine": verify_report.ok && verify_report.sheet_names.len() == 7
    }))
}

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() < 3 {
        eprintln!(
            "Kullanım:\n  caelus_xlsx_engine read <xlsx_dosya_yolu>\n  caelus_xlsx_engine export-report <rapor_spec.json> <cikti.xlsx>"
        );
        std::process::exit(1);
    }

    let cmd = args[1].as_str();
    match cmd {
        "read" => {
            let path = Path::new(&args[2]);
            let report = read_xlsx_with_calamine(path);
            println!(
                "{}",
                serde_json::to_string_pretty(&report).unwrap_or_else(|_| "{}".to_string())
            );
        }
        "export-report" => {
            if args.len() < 4 {
                eprintln!("HATA: export-report için <rapor_spec.json> ve <cikti.xlsx> gerekli");
                std::process::exit(1);
            }
            let spec_path = Path::new(&args[2]);
            let out_path = Path::new(&args[3]);
            match export_xlsx_report(spec_path, out_path) {
                Ok(res) => println!("{}", serde_json::to_string_pretty(&res).unwrap()),
                Err(err) => {
                    println!(
                        "{}",
                        serde_json::to_string_pretty(&json!({
                            "ok": false,
                            "error": err
                        }))
                        .unwrap()
                    );
                    std::process::exit(1);
                }
            }
        }
        _ => {
            eprintln!("Bilinmeyen komut: {}", cmd);
            std::process::exit(1);
        }
    }
}
