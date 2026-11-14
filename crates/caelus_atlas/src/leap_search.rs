//! Sub-Millisecond Zero-Copy `LEAP` Global Search & 4-Gate Route Matching API.
//!
//! Maps `vessels_blocks.rkyv`, `vessels_index.rkyv`, `entities_blocks.rkyv`,
//! `entities_index.rkyv`, and `spo_graph.rkyv` read-only with near-zero startup RSS,
//! evaluating `LEAP` queries across `100,000+` real vessels and `110,000+` ports in `< 1 ms`.

use crate::bitemporal_xtdb::{BitemporalAtlasEvent, BitemporalEventLog};
use crate::fleet_schema::{
    ArchivedClassSociety, ArchivedClassStatus, ArchivedNoxTier, ArchivedPiClub,
    ArchivedPortFullRecord, ArchivedPropulsionFuel, ArchivedVesselFullRecord, ArchivedVesselType,
};
use crate::mmap_store::{normalize_search_key, AtlasManifestStats, MmapAtlasStore};
use crate::spo_graph::{vessel_iri, MmapSpoGraph, SpoTripleView};
use caelus_core::vessel_route_matcher::{
    evaluate_four_gate_suitability, is_eu_eea_flag, FourGateSuitability, FuelKindCode,
    RouteMatchSpec, StraitRegime, VesselMatchInput,
};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::Instant;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum LeapEntityKind {
    Vessel,
    Port,
    Company,
    Country,
    Regulation,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LeapLookupResult {
    pub kind: LeapEntityKind,
    pub entity_key: String,
    pub primary_label: String,
    pub secondary_label: String,
    pub lat_microdeg: Option<i64>,
    pub lon_microdeg: Option<i64>,
    pub unlocode: Option<String>,
    pub imo: Option<u32>,
    pub mmsi: Option<u32>,
    pub flag_iso2: Option<String>,
    pub iacs_member: Option<bool>,
    pub elapsed_us: u64,
}

pub struct LivingAtlas {
    mmap_dir: PathBuf,
    store: MmapAtlasStore,
    spo: Option<MmapSpoGraph>,
}

/// Resolves workspace `data/<subpath>` reliably regardless of current working directory
/// (repo root vs `crates/<name>` under `cargo test` vs `target/release/caelus_ui.exe`).
#[must_use]
pub fn resolve_atlas_data_path(rel_subpath: &str) -> PathBuf {
    let direct = PathBuf::from("data").join(rel_subpath);
    if direct.exists() {
        return direct;
    }
    if let Ok(cwd) = std::env::current_dir() {
        for anc in cwd.ancestors().take(5) {
            let cand = anc.join("data").join(rel_subpath);
            if cand.exists() {
                return cand;
            }
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        for anc in exe.ancestors().take(5) {
            let cand = anc.join("data").join(rel_subpath);
            if cand.exists() {
                return cand;
            }
        }
    }
    direct
}

impl LivingAtlas {
    pub fn open_readonly(mmap_dir: &Path) -> Result<Self, String> {
        let store = MmapAtlasStore::open(mmap_dir)?;
        let spo_path = mmap_dir.join("spo_graph.rkyv");
        let spo = if spo_path.exists() {
            MmapSpoGraph::open(&spo_path).ok()
        } else {
            None
        };
        Ok(Self {
            mmap_dir: mmap_dir.to_path_buf(),
            store,
            spo,
        })
    }

    pub fn open_default_readonly() -> Result<Self, String> {
        let dir = resolve_atlas_data_path("atlas_mmap");
        Self::open_readonly(&dir)
    }

    #[must_use]
    pub const fn stats(&self) -> AtlasManifestStats {
        self.store.stats()
    }

    #[must_use]
    pub fn store(&self) -> &MmapAtlasStore {
        &self.store
    }

    #[must_use]
    pub fn mmap_dir(&self) -> &Path {
        &self.mmap_dir
    }

    #[must_use]
    pub fn spo_triples_for_vessel(
        &self,
        imo: u32,
        mmsi: u32,
        name: &str,
        max: usize,
    ) -> Vec<SpoTripleView> {
        let Some(ref spo) = self.spo else {
            return Vec::new();
        };
        let iri = vessel_iri(imo, mmsi, name);
        spo.triples_for_subject(&iri, max)
    }

    pub fn query_vessel_sparql(
        &self,
        imo: u32,
        mmsi: u32,
        name: &str,
        sparql: &str,
    ) -> Result<Vec<Vec<(String, String)>>, String> {
        let Some(ref spo) = self.spo else {
            return Err("spo_graph.rkyv is not mounted".to_string());
        };
        let iri = vessel_iri(imo, mmsi, name);
        spo.query_active_subgraph_sparql(&iri, sparql)
    }

    pub fn query_subject_sparql(
        &self,
        root_iri: &str,
        sparql: &str,
    ) -> Result<Vec<Vec<(String, String)>>, String> {
        let Some(ref spo) = self.spo else {
            return Err("spo_graph.rkyv is not mounted".to_string());
        };
        spo.query_active_subgraph_sparql(root_iri, sparql)
    }

    pub fn load_bitemporal_history(
        &self,
        entity_key: &str,
    ) -> Result<Vec<BitemporalAtlasEvent>, String> {
        let path = self.mmap_dir.join("xtdb_bitemporal.rkyv");
        let log = BitemporalEventLog::load_or_new(&path)?;
        Ok(log
            .history_for_entity(entity_key)
            .into_iter()
            .cloned()
            .collect())
    }

    /// Executes a zero-copy `LEAP` lookup across vessels, UN/LOCODE+SMDG ports,
    /// companies, countries, and regulations in `< 1 ms`.
    pub fn leap_search(&self, raw_query: &str) -> Result<Option<LeapLookupResult>, String> {
        let t0 = Instant::now();
        let trimmed = raw_query.trim();
        if trimmed.is_empty() {
            return Ok(None);
        }

        let norm = normalize_search_key(trimmed);
        // 1. Direct IMO number lookup (`IMO9552070`, `IMO 9552070`, or 6-7 digits)
        if let Some(imo) = parse_imo_query(&norm) {
            if let Some(v) = self.store.get_vessel_by_imo(imo)? {
                return Ok(Some(vessel_to_leap_result(
                    v,
                    t0.elapsed().as_micros() as u64,
                )));
            }
        }

        // 2. Direct MMSI lookup (9 digits)
        if let Some(mmsi) = parse_mmsi_query(&norm) {
            if let Some(v) = self.store.get_vessel_by_mmsi(mmsi)? {
                return Ok(Some(vessel_to_leap_result(
                    v,
                    t0.elapsed().as_micros() as u64,
                )));
            }
        }

        // 3. Exact UN/LOCODE (5 chars, e.g. `TRSEF`, `GRSMI`, `NLRTM`)
        if norm.len() == 5
            && !norm.contains(' ')
            && norm.as_bytes()[0].is_ascii_alphabetic()
            && norm.as_bytes()[1].is_ascii_alphabetic()
        {
            if let Some(p) = self.store.get_port_by_unlocode(&norm)? {
                return Ok(Some(port_to_leap_result(
                    p,
                    t0.elapsed().as_micros() as u64,
                )));
            }
        }

        // 4. Exact 2-letter Country ISO2
        if norm.len() == 2 && norm.bytes().all(|b| b.is_ascii_alphabetic()) {
            if let Some(k) = self.store.get_country_by_iso2(&norm)? {
                let iso_str = std::str::from_utf8(&k.iso2).unwrap_or("XX").to_string();
                let lat = k.lat_microdeg.to_native();
                let lon = k.lon_microdeg.to_native();
                return Ok(Some(LeapLookupResult {
                    kind: LeapEntityKind::Country,
                    entity_key: format!("country:{iso_str}"),
                    primary_label: format!("{} ({iso_str})", k.name.as_str()),
                    secondary_label: format!(
                        "Ports: {} | Flagged Fleet: {} | Paris MoU: {}",
                        k.port_count.to_native(),
                        k.flagged_vessel_count.to_native(),
                        k.paris_mou_list.as_str()
                    ),
                    lat_microdeg: (lat != 0).then_some(lat),
                    lon_microdeg: (lon != 0).then_some(lon),
                    unlocode: (!k.capital_port_unlocode.is_empty())
                        .then(|| k.capital_port_unlocode.as_str().to_string()),
                    imo: None,
                    mmsi: None,
                    flag_iso2: Some(iso_str),
                    iacs_member: None,
                    elapsed_us: t0.elapsed().as_micros() as u64,
                }));
            }
        }

        // 5. Prefix binary search across Ship Name / Former Name / Callsign / ENI
        if let Some(v) = self
            .store
            .search_vessels_by_token(&norm, 1)?
            .first()
            .copied()
        {
            return Ok(Some(vessel_to_leap_result(
                v,
                t0.elapsed().as_micros() as u64,
            )));
        }

        // 6. Prefix search across Ports / SMDG Terminals
        if let Some(p) = self.store.search_ports_by_token(&norm, 1)?.first().copied() {
            return Ok(Some(port_to_leap_result(
                p,
                t0.elapsed().as_micros() as u64,
            )));
        }

        // 7. Prefix search across Maritime Companies / Terminal Operators
        if let Some(c) = self
            .store
            .search_companies_by_token(&norm, 1)?
            .first()
            .copied()
        {
            let iso = std::str::from_utf8(&c.country_iso2)
                .unwrap_or("XX")
                .to_string();
            return Ok(Some(LeapLookupResult {
                kind: LeapEntityKind::Company,
                entity_key: format!("company:{}", c.company_id.as_str()),
                primary_label: c.name.as_str().to_string(),
                secondary_label: format!(
                    "Country: {iso} | Sanctions: {} | Datasets: {}",
                    if c.opensanctions_flagged {
                        "ALERT"
                    } else {
                        "CLEAR"
                    },
                    c.datasets.len()
                ),
                lat_microdeg: None,
                lon_microdeg: None,
                unlocode: (!c.primary_port_unlocode.is_empty())
                    .then(|| c.primary_port_unlocode.as_str().to_string()),
                imo: None,
                mmsi: None,
                flag_iso2: Some(iso),
                iacs_member: None,
                elapsed_us: t0.elapsed().as_micros() as u64,
            }));
        }

        // 8. Prefix search across Countries by full name
        if let Some(k) = self
            .store
            .search_countries_by_token(&norm, 1)?
            .first()
            .copied()
        {
            let iso_str = std::str::from_utf8(&k.iso2).unwrap_or("XX").to_string();
            let lat = k.lat_microdeg.to_native();
            let lon = k.lon_microdeg.to_native();
            return Ok(Some(LeapLookupResult {
                kind: LeapEntityKind::Country,
                entity_key: format!("country:{iso_str}"),
                primary_label: format!("{} ({iso_str})", k.name.as_str()),
                secondary_label: format!(
                    "Ports: {} | Fleet: {}",
                    k.port_count.to_native(),
                    k.flagged_vessel_count.to_native()
                ),
                lat_microdeg: (lat != 0).then_some(lat),
                lon_microdeg: (lon != 0).then_some(lon),
                unlocode: (!k.capital_port_unlocode.is_empty())
                    .then(|| k.capital_port_unlocode.as_str().to_string()),
                imo: None,
                mmsi: None,
                flag_iso2: Some(iso_str),
                iacs_member: None,
                elapsed_us: t0.elapsed().as_micros() as u64,
            }));
        }

        // 9. Prefix search across Regulations
        if let Some(r) = self
            .store
            .search_regulations_by_token(&norm, 1)?
            .first()
            .copied()
        {
            let jur = std::str::from_utf8(&r.jurisdiction_iso2)
                .unwrap_or("EU")
                .to_string();
            return Ok(Some(LeapLookupResult {
                kind: LeapEntityKind::Regulation,
                entity_key: format!("regulation:{}", r.rule_id.as_str()),
                primary_label: format!("{} ({})", r.title.as_str(), r.celex_or_ref.as_str()),
                secondary_label: r.summary.as_str().to_string(),
                lat_microdeg: None,
                lon_microdeg: None,
                unlocode: None,
                imo: None,
                mmsi: None,
                flag_iso2: Some(jur),
                iacs_member: None,
                elapsed_us: t0.elapsed().as_micros() as u64,
            }));
        }

        Ok(None)
    }

    /// Evaluates 4-Gate Vessel-to-Route Suitability for `imo` between `origin_unlocode` and `dest_unlocode`.
    pub fn evaluate_vessel_on_ports(
        &self,
        imo: u32,
        origin_unlocode: &str,
        dest_unlocode: &str,
    ) -> Result<Option<(FourGateSuitability, RouteMatchSpec)>, String> {
        let Some(v) = self.store.get_vessel_by_imo(imo)? else {
            return Ok(None);
        };
        let Some(origin) = self.store.get_port_by_unlocode(origin_unlocode)? else {
            return Ok(None);
        };
        let Some(dest) = self.store.get_port_by_unlocode(dest_unlocode)? else {
            return Ok(None);
        };
        let v_in = vessel_to_match_input(v);
        let route = ports_to_route_spec(origin, dest);
        let res = evaluate_four_gate_suitability(&v_in, &route);
        Ok(Some((res, route)))
    }
}

fn parse_imo_query(norm: &str) -> Option<u32> {
    if let Some(rest) = norm.strip_prefix("IMO") {
        let digits = rest.trim();
        if (6..=7).contains(&digits.len()) && digits.bytes().all(|b| b.is_ascii_digit()) {
            return digits.parse::<u32>().ok();
        }
    } else if (6..=7).contains(&norm.len()) && norm.bytes().all(|b| b.is_ascii_digit()) {
        return norm.parse::<u32>().ok();
    }
    None
}

fn parse_mmsi_query(norm: &str) -> Option<u32> {
    if let Some(rest) = norm.strip_prefix("MMSI") {
        let digits = rest.trim();
        if digits.len() == 9 && digits.bytes().all(|b| b.is_ascii_digit()) {
            return digits.parse::<u32>().ok();
        }
    } else if norm.len() == 9 && norm.bytes().all(|b| b.is_ascii_digit()) {
        return norm.parse::<u32>().ok();
    }
    None
}

fn archived_class_is_iacs(soc: &ArchivedClassSociety) -> bool {
    !matches!(
        soc,
        ArchivedClassSociety::RmrsNonIacs | ArchivedClassSociety::OtherNonIacs
    )
}

fn archived_class_code(soc: &ArchivedClassSociety) -> &'static str {
    match soc {
        ArchivedClassSociety::Abs => "ABS",
        ArchivedClassSociety::Bv => "BV",
        ArchivedClassSociety::Ccs => "CCS",
        ArchivedClassSociety::Crs => "CRS",
        ArchivedClassSociety::Dnv => "DNV",
        ArchivedClassSociety::Irs => "IRS",
        ArchivedClassSociety::Kr => "KR",
        ArchivedClassSociety::Lr => "LR",
        ArchivedClassSociety::Nk => "NK",
        ArchivedClassSociety::Prs => "PRS",
        ArchivedClassSociety::Rina => "RINA",
        ArchivedClassSociety::Tl => "TL",
        ArchivedClassSociety::RmrsNonIacs => "RMRS (Non-IACS)",
        ArchivedClassSociety::OtherNonIacs => "Non-IACS",
    }
}

fn archived_pi_is_ig_or_turk(club: &ArchivedPiClub) -> bool {
    !matches!(
        club,
        ArchivedPiClub::FixedPremium | ArchivedPiClub::OtherNonIg
    )
}

fn archived_pi_code(club: &ArchivedPiClub) -> &'static str {
    match club {
        ArchivedPiClub::AmericanClub => "American Club (IG)",
        ArchivedPiClub::Britannia => "Britannia (IG)",
        ArchivedPiClub::Gard => "Gard (IG)",
        ArchivedPiClub::JapanPi => "Japan P&I (IG)",
        ArchivedPiClub::LondonPi => "London P&I (IG)",
        ArchivedPiClub::NorthStandard => "NorthStandard (IG)",
        ArchivedPiClub::Shipowners => "Shipowners (IG)",
        ArchivedPiClub::Skuld => "Skuld (IG)",
        ArchivedPiClub::SteamshipMutual => "Steamship Mutual (IG)",
        ArchivedPiClub::SwedishClub => "Swedish Club (IG)",
        ArchivedPiClub::UkPi => "UK P&I (IG)",
        ArchivedPiClub::WestOfEngland => "West of England (IG)",
        ArchivedPiClub::TurkPi => "Turk P&I",
        ArchivedPiClub::FixedPremium => "Fixed-Premium P&I",
        ArchivedPiClub::OtherNonIg => "Non-IG Mutual",
    }
}

fn vessel_to_leap_result(v: &ArchivedVesselFullRecord, elapsed_us: u64) -> LeapLookupResult {
    let imo = v.imo.to_native();
    let mmsi = v.mmsi.to_native();
    let flag = std::str::from_utf8(&v.current_flag_iso2)
        .unwrap_or("XX")
        .to_string();
    let iacs = archived_class_is_iacs(&v.class_chain.society);
    let class_str = archived_class_code(&v.class_chain.society);
    let pi_str = archived_pi_code(&v.pi_chain.club);
    let lat = v.live_ais.lat_microdeg.to_native();
    let lon = v.live_ais.lon_microdeg.to_native();
    let sanc_tag = if v.opensanctions_match {
        "SANCTIONS MATCH"
    } else if !v.pi_chain.feb20_blue_card_active {
        "BLUE CARD EXPIRED"
    } else {
        "CLEAR"
    };

    LeapLookupResult {
        kind: LeapEntityKind::Vessel,
        entity_key: if imo > 0 {
            format!("vessel:IMO{imo}")
        } else {
            format!("vessel:MMSI{mmsi}")
        },
        primary_label: format!(
            "{} | IMO {} | {} ({})",
            v.current_name.as_str(),
            imo,
            flag,
            class_str
        ),
        secondary_label: format!(
            "P&I: {} | BlueCard: {} | GT: {} | LOA: {}m | {}",
            pi_str,
            if v.pi_chain.feb20_blue_card_active {
                "Active"
            } else {
                "Expired"
            },
            v.gt.to_native(),
            v.loa_mm.to_native() / 1_000,
            sanc_tag
        ),
        lat_microdeg: (lat != 0).then_some(lat),
        lon_microdeg: (lon != 0).then_some(lon),
        unlocode: (!v.live_ais.destination.is_empty())
            .then(|| v.live_ais.destination.as_str().to_string()),
        imo: (imo > 0).then_some(imo),
        mmsi: (mmsi > 0).then_some(mmsi),
        flag_iso2: Some(flag),
        iacs_member: Some(iacs),
        elapsed_us,
    }
}

fn port_to_leap_result(p: &ArchivedPortFullRecord, elapsed_us: u64) -> LeapLookupResult {
    let lat = p.lat_microdeg.to_native();
    let lon = p.lon_microdeg.to_native();
    let iso = std::str::from_utf8(&p.country_iso2)
        .unwrap_or("XX")
        .to_string();
    let smdg_info = p
        .terminals
        .first()
        .map(|t| {
            format!(
                " | SMDG: {} ({})",
                t.terminal_code.as_str(),
                t.company_name.as_str()
            )
        })
        .unwrap_or_default();

    LeapLookupResult {
        kind: LeapEntityKind::Port,
        entity_key: format!("port:{}", p.unlocode.as_str()),
        primary_label: format!("{} ({})", p.name.as_str(), p.unlocode.as_str()),
        secondary_label: format!(
            "Country: {} | Depth: {}.{}m | OPS: {}{}",
            iso,
            p.max_depth_mm.to_native() / 1_000,
            (p.max_depth_mm.to_native() % 1_000) / 100,
            if p.ops_shore_power { "Yes" } else { "No" },
            smdg_info
        ),
        lat_microdeg: (lat != 0).then_some(lat),
        lon_microdeg: (lon != 0).then_some(lon),
        unlocode: Some(p.unlocode.as_str().to_string()),
        imo: None,
        mmsi: None,
        flag_iso2: Some(iso),
        iacs_member: None,
        elapsed_us,
    }
}

/// Converts a zero-copy archived `ArchivedVesselFullRecord` into a `VesselMatchInput`
/// for `caelus_core::vessel_route_matcher` (`0` heap allocations).
#[must_use]
pub fn vessel_to_match_input(v: &ArchivedVesselFullRecord) -> VesselMatchInput {
    let fuel_kind = match v.fuel_type {
        ArchivedPropulsionFuel::Mgo => FuelKindCode::Mgo,
        ArchivedPropulsionFuel::Vlsfo => FuelKindCode::Vlsfo,
        ArchivedPropulsionFuel::Lng => FuelKindCode::Lng,
        ArchivedPropulsionFuel::Methanol => FuelKindCode::Methanol,
        ArchivedPropulsionFuel::Ammonia => FuelKindCode::Ammonia,
        ArchivedPropulsionFuel::Battery | ArchivedPropulsionFuel::OpsHybrid => {
            FuelKindCode::Battery
        }
    };
    let nox_tier = match v.nox_tier {
        ArchivedNoxTier::TierI => 1,
        ArchivedNoxTier::TierII => 2,
        ArchivedNoxTier::TierIII => 3,
    };
    let is_oil_tanker = matches!(
        v.vessel_type,
        ArchivedVesselType::TankerProduct | ArchivedVesselType::TankerVlcc
    );
    let is_passenger_vessel = matches!(
        v.vessel_type,
        ArchivedVesselType::RoPax | ArchivedVesselType::HscSolasX | ArchivedVesselType::Cruise
    );
    let is_hazmat_cargo = matches!(
        v.vessel_type,
        ArchivedVesselType::TankerProduct
            | ArchivedVesselType::TankerVlcc
            | ArchivedVesselType::ChemicalIbc
            | ArchivedVesselType::GasLngIgc
            | ArchivedVesselType::GasLpgIgc
    );
    let cii_rating = match v.cii_rating {
        crate::fleet_schema::ArchivedCiiRating::Exempt => 0,
        crate::fleet_schema::ArchivedCiiRating::A => 1,
        crate::fleet_schema::ArchivedCiiRating::B => 2,
        crate::fleet_schema::ArchivedCiiRating::C => 3,
        crate::fleet_schema::ArchivedCiiRating::D => 4,
        crate::fleet_schema::ArchivedCiiRating::E => 5,
    };
    let psc_banned = v.psc_records.iter().any(|r| r.banned);

    VesselMatchInput {
        imo: v.imo.to_native(),
        mmsi: v.mmsi.to_native(),
        flag_iso2: v.current_flag_iso2,
        gt: v.gt.to_native(),
        dwt_tons: v.dwt_tons.to_native(),
        loa_mm: v.loa_mm.to_native(),
        beam_mm: v.beam_mm.to_native(),
        air_draft_mm: v.air_draft_mm.to_native(),
        active_draft_mm: v.summer_draft_mm.to_native(),
        service_speed_centikn: v.service_speed_centikn.to_native(),
        block_coeff_bp: v.block_coeff_bp.to_native(),
        teu: v.teu.to_native(),
        lane_meters: v.lane_meters.to_native(),
        pax_capacity: v.pax_capacity.to_native(),
        main_engine_kw: v.main_engine_kw.to_native(),
        aux_gen_kw: v.aux_gen_kw.to_native(),
        sfoc_dg_kwh: v.sfoc_dg_kwh.to_native(),
        nox_tier,
        fuel_kind,
        scrubber_fitted: v.scrubber_fitted,
        ops_ready: v.ops_ready,
        is_oil_tanker,
        is_passenger_vessel,
        is_hazmat_cargo,
        iacs_member: archived_class_is_iacs(&v.class_chain.society),
        class_in_class: matches!(v.class_chain.status, ArchivedClassStatus::InClass),
        conditions_of_class: v.class_chain.conditions_of_class,
        survey_overdue: v.class_chain.survey_overdue,
        ig_or_turk_pi: archived_pi_is_ig_or_turk(&v.pi_chain.club),
        feb20_blue_card_active: v.pi_chain.feb20_blue_card_active,
        bunker_blue_card: v.pi_chain.bunker_1000gt_cert,
        clc92_blue_card: v.pi_chain.clc92_2000gt_cert,
        wrc_blue_card: v.pi_chain.nairobi_wrc_300gt_cert,
        athens_blue_card: v.pi_chain.athens_pax_cert,
        jwc_war_risk_active: v.pi_chain.jwc_war_risk_active,
        psc_banned,
        opensanctions_flagged: v.opensanctions_match,
        cii_rating,
        daily_opex_cents: v.daily_opex_cents.to_native(),
    }
}

/// Constructs a realistic fixed-point `RouteMatchSpec` between two `ArchivedPortFullRecord`s.
#[must_use]
pub fn ports_to_route_spec(
    origin: &ArchivedPortFullRecord,
    dest: &ArchivedPortFullRecord,
) -> RouteMatchSpec {
    let o_lat = (origin.lat_microdeg.to_native() as f64) / 1_000_000.0;
    let o_lon = (origin.lon_microdeg.to_native() as f64) / 1_000_000.0;
    let d_lat = (dest.lat_microdeg.to_native() as f64) / 1_000_000.0;
    let d_lon = (dest.lon_microdeg.to_native() as f64) / 1_000_000.0;
    let nm = if (o_lat == 0.0 && o_lon == 0.0) || (d_lat == 0.0 && d_lon == 0.0) {
        120.0
    } else {
        let dphi = (d_lat - o_lat).to_radians();
        let dlam = (d_lon - o_lon).to_radians();
        let a = (dphi / 2.0).sin().powi(2)
            + o_lat.to_radians().cos() * d_lat.to_radians().cos() * (dlam / 2.0).sin().powi(2);
        let c = 2.0 * a.sqrt().atan2((1.0 - a).sqrt());
        (c * 6_371.008_8 / 1.852).max(8.0)
    };

    let o_iso = origin.country_iso2;
    let d_iso = dest.country_iso2;
    let o_eu = is_eu_eea_flag(o_iso);
    let d_eu = is_eu_eea_flag(d_iso);
    let ets_scope_bp = if o_eu && d_eu {
        10_000
    } else if o_eu || d_eu {
        5_000
    } else {
        0
    };

    let crosses_black_sea = |c: [u8; 2]| matches!(&c, b"RU" | b"UA" | b"RO" | b"BG" | b"GE");
    let strait = if (crosses_black_sea(o_iso) && !crosses_black_sea(d_iso))
        || (!crosses_black_sea(o_iso) && crosses_black_sea(d_iso))
    {
        StraitRegime::TurkishStraitsMontreux
    } else {
        StraitRegime::None
    };

    let in_sox_eca = o_eu
        || d_eu
        || matches!(&o_iso, b"TR" | b"NO" | b"US" | b"CA" | b"GB")
        || matches!(&d_iso, b"TR" | b"NO" | b"US" | b"CA" | b"GB");
    let min_channel_depth_mm = origin
        .max_depth_mm
        .to_native()
        .min(dest.max_depth_mm.to_native())
        .max(5_000);
    let max_berth_loa_mm = origin
        .max_loa_mm
        .to_native()
        .min(dest.max_loa_mm.to_native())
        .max(120_000);
    let max_berth_beam_mm = origin
        .max_beam_mm
        .to_native()
        .min(dest.max_beam_mm.to_native())
        .max(22_000);

    let distance_nm_milli = (nm * 1_000.0).round() as u32;
    // Realistic market charter freight scaling cleanly with voyage NM
    let gross_freight_cents = 2_400_000 + ((nm as i64) * 32_000);

    RouteMatchSpec {
        origin_country_iso2: o_iso,
        dest_country_iso2: d_iso,
        distance_nm_milli,
        min_channel_depth_mm,
        required_ukc_mm: 1_200,
        wave_heave_mm: 350,
        max_berth_loa_mm,
        max_berth_beam_mm,
        min_air_draft_limit_mm: origin
            .air_draft_limit_mm
            .to_native()
            .min(dest.air_draft_limit_mm.to_native())
            .max(50_000),
        min_teu: 0,
        min_lane_meters: 0,
        min_pax: 0,
        min_dwt_tons: 200,
        require_iacs: true,
        require_ig_or_turk_pi: true,
        max_conditions_of_class: 1,
        in_jwc_war_zone: matches!(&o_iso, b"UA" | b"RU" | b"YE")
            || matches!(&d_iso, b"UA" | b"RU" | b"YE"),
        enforce_cabotage: o_iso == d_iso,
        eu_eea_cabotage_open: o_eu && d_eu,
        in_sox_eca,
        in_nox_eca: matches!(
            &o_iso,
            b"FI" | b"SE" | b"NO" | b"DK" | b"DE" | b"NL" | b"US" | b"CA"
        ) || matches!(
            &d_iso,
            b"FI" | b"SE" | b"NO" | b"DK" | b"DE" | b"NL" | b"US" | b"CA"
        ),
        strait,
        reject_cii_e: true,
        port_ops_available: origin.ops_shore_power || dest.ops_shore_power,
        port_turnaround_hours: 4,
        gross_freight_cents,
        port_dues_cents: 180_000,
        strait_tolls_cents: if matches!(strait, StraitRegime::TurkishStraitsMontreux) {
            240_000
        } else {
            0
        },
        bunker_price_cents_per_ton: 72_000,
        ets_price_cents_per_ton: 8_500,
        ets_scope_bp,
    }
}
