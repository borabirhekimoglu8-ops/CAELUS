use caelus_atlas::mcp_bridge::handle_mcp_jsonrpc_line;
use caelus_atlas::{LeapEntityKind, LivingAtlas};
use serde_json::Value;
use std::time::Instant;

#[test]
fn atlas_100k_scale_sub_ms_leap_sparql_xtdb_and_four_gate_work() {
    let atlas = LivingAtlas::open_default_readonly()
        .expect("data/atlas_mmap must be built via caelus-atlas-sync");
    let st = atlas.stats();

    assert!(
        st.vessel_count >= 100_000,
        "expected >= 100,000 vessels, got {}",
        st.vessel_count
    );
    assert!(
        st.iacs_count >= 60_223,
        "expected >= 60,223 IACS vessels, got {}",
        st.iacs_count
    );
    assert!(
        st.port_count >= 100_000,
        "expected >= 100,000 UN/LOCODE ports, got {}",
        st.port_count
    );
    assert!(
        st.smdg_count >= 1_200,
        "expected >= 1,200 SMDG terminals, got {}",
        st.smdg_count
    );

    // Warm one page then benchmark 100 sampled real IMOs + named entities (< 1 ms)
    let sample_imos = atlas.store().sample_vessel_imos(100);
    assert_eq!(sample_imos.len(), 100);
    let _ = atlas
        .leap_search(&format!("IMO{}", sample_imos[0]))
        .unwrap();

    let t0 = Instant::now();
    for &imo in &sample_imos {
        let res = atlas
            .leap_search(&format!("IMO{imo}"))
            .expect("imo search")
            .expect("imo hit");
        assert_eq!(res.kind, LeapEntityKind::Vessel);
        assert_eq!(res.imo, Some(imo));
    }
    let avg_us = (t0.elapsed().as_micros() as u64) / (sample_imos.len() as u64);
    assert!(
        avg_us < 1_000,
        "expected < 1000 us average LEAP lookup across 100k+ fleet, got {avg_us} us"
    );

    // Exact Aegean anchor port check
    let grsmi = atlas
        .leap_search("GRSMI")
        .expect("grsmi")
        .expect("grsmi hit");
    assert_eq!(grsmi.kind, LeapEntityKind::Port);
    assert_eq!(grsmi.lat_microdeg, Some(37_754_000));
    assert_eq!(grsmi.lon_microdeg, Some(26_978_000));
    assert!(grsmi.elapsed_us < 2_000);

    // Company / Country / Regulation lookups
    let tr = atlas.leap_search("TR").expect("tr").expect("tr hit");
    assert_eq!(tr.kind, LeapEntityKind::Country);
    let fueleu = atlas
        .leap_search("FUELEU")
        .expect("fueleu")
        .expect("fueleu hit");
    assert_eq!(fueleu.kind, LeapEntityKind::Regulation);

    // 4-Gate Vessel-to-Route Suitability on real vessel (Faromar IMO 9552070 -> Aegean ports)
    let faromar = atlas
        .leap_search("FAROMAR")
        .expect("faromar")
        .expect("faromar hit");
    assert_eq!(faromar.kind, LeapEntityKind::Vessel);
    let eval_imo = faromar.imo.unwrap_or(sample_imos[0]);
    let (suitability, _) = atlas
        .evaluate_vessel_on_ports(eval_imo, "TRSEF", "GRSMI")
        .expect("eval ok")
        .expect("eval some");
    assert_eq!(suitability.imo, eval_imo);
    assert!(suitability.voyage_hours_milli > 0);

    // Oxigraph Active Subgraph SPARQL query
    let rows = atlas
        .query_vessel_sparql(
            eval_imo,
            faromar.mmsi.unwrap_or(0),
            &faromar.primary_label,
            "SELECT ?name ?iacs WHERE { ?v <urn:caelus:prop:name> ?name ; <urn:caelus:prop:iacsMember> ?iacs . }",
        )
        .expect("oxigraph sparql");
    assert!(!rows.is_empty());

    // XTDB bitemporal non-destructive history check
    let hist = atlas
        .load_bitemporal_history("atlas:global_fleet")
        .expect("xtdb history");
    assert!(!hist.is_empty());

    // MCP JSON-RPC Axiom-2 stringified integer check
    let rpc_resp = handle_mcp_jsonrpc_line(
        &atlas,
        r#"{"jsonrpc":"2.0","id":42,"method":"tools/call","params":{"name":"atlas_delta_status","arguments":{}}}"#,
    )
    .expect("rpc resp");
    let v: Value = serde_json::from_str(&rpc_resp).expect("rpc json");
    let count_str = v["result"]["structuredContent"]["vessel_count"]
        .as_str()
        .expect("vessel_count stringified per Axiom A-2");
    assert!(count_str.parse::<u64>().unwrap() >= 100_000);
}
