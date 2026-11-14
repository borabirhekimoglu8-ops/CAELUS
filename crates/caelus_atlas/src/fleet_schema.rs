//! Complete Global Maritime Schema for `caelus_atlas` (`rkyv` zero-copy + `serde`).
//!
//! Covers:
//! - Full global vessel registry (`VesselFullRecord`): identity, 5y flag history, dimensions,
//!   machinery, propulsion/fuel, 12 IACS + RMRS class chain, 12 IG P&I + Turk P&I + Feb 20 Blue Cards,
//!   GLEIF/BODS corporate chain, live AIS, SAR dark signals, STS history, MoU PSC, CII, OpenSanctions.
//! - Global ports & terminals (`PortFullRecord`: UN/LOCODE + SMDG + IMF PortWatch + WorldPop + GTFS-RT).
//! - Maritime companies, fleet operators, UBOs & port agents (`CompanyProfile`).
//! - Country maritime regimes (`CountryMaritimeProfile`: cabotage, MoU, ECA, tonnage tax, UNCLOS/IMO).
//! - Regulatory rules (`RegulationRuleRecord`: EUR-Lex CELLAR, IMO GISIS, UNCLOS, Paris/Tokyo MoU, EMSWe).

use crate::serde_i64_str::{i64_str, u64_str};
use caelus_core::vessel_route_matcher::FuelKindCode;
use rkyv::{Archive, Deserialize as RkyvDeserialize, Serialize as RkyvSerialize};
use serde::{Deserialize, Serialize};

#[derive(
    Archive,
    RkyvSerialize,
    RkyvDeserialize,
    Serialize,
    Deserialize,
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
)]
pub enum EpistemicStatus {
    Observation = 0,
    Claim = 1,
    Hypothesis = 2,
}

impl EpistemicStatus {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Observation => "OBSERVATION",
            Self::Claim => "CLAIM",
            Self::Hypothesis => "HYPOTHESIS",
        }
    }
}

#[derive(
    Archive,
    RkyvSerialize,
    RkyvDeserialize,
    Serialize,
    Deserialize,
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
)]
pub enum VesselType {
    RoPax,
    HscSolasX,
    Cruise,
    ContainerFeeder,
    ContainerPanamax,
    ContainerUlcv,
    BulkHandy,
    BulkSupra,
    BulkCapesize,
    TankerProduct,
    TankerVlcc,
    ChemicalIbc,
    GasLngIgc,
    GasLpgIgc,
    OffshorePsv,
    OffshoreAhts,
    CableLayer,
    Tug,
    Pilot,
    InlandEni,
    GeneralCargo,
}

impl VesselType {
    #[must_use]
    pub const fn code(self) -> &'static str {
        match self {
            Self::RoPax => "Ro-Pax",
            Self::HscSolasX => "HSC (SOLAS X)",
            Self::Cruise => "Cruise",
            Self::ContainerFeeder => "Container Feeder",
            Self::ContainerPanamax => "Container Panamax",
            Self::ContainerUlcv => "Container ULCV",
            Self::BulkHandy => "Bulk Handy",
            Self::BulkSupra => "Bulk Supramax",
            Self::BulkCapesize => "Bulk Capesize",
            Self::TankerProduct => "Product Tanker",
            Self::TankerVlcc => "VLCC",
            Self::ChemicalIbc => "Chemical (IBC)",
            Self::GasLngIgc => "LNG (IGC)",
            Self::GasLpgIgc => "LPG (IGC)",
            Self::OffshorePsv => "Offshore PSV",
            Self::OffshoreAhts => "Offshore AHTS",
            Self::CableLayer => "Cable Layer",
            Self::Tug => "Tug",
            Self::Pilot => "Pilot",
            Self::InlandEni => "Inland ENI",
            Self::GeneralCargo => "General Cargo",
        }
    }

    #[must_use]
    pub const fn is_oil_tanker(self) -> bool {
        matches!(self, Self::TankerProduct | Self::TankerVlcc)
    }

    #[must_use]
    pub const fn is_passenger(self) -> bool {
        matches!(self, Self::RoPax | Self::HscSolasX | Self::Cruise)
    }

    #[must_use]
    pub const fn is_hazmat(self) -> bool {
        matches!(
            self,
            Self::TankerProduct
                | Self::TankerVlcc
                | Self::ChemicalIbc
                | Self::GasLngIgc
                | Self::GasLpgIgc
        )
    }
}

#[derive(
    Archive,
    RkyvSerialize,
    RkyvDeserialize,
    Serialize,
    Deserialize,
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
)]
pub enum PropulsionFuel {
    Mgo,
    Vlsfo,
    Lng,
    Methanol,
    Ammonia,
    Battery,
    OpsHybrid,
}

impl PropulsionFuel {
    #[must_use]
    pub const fn to_matcher_fuel(self) -> FuelKindCode {
        match self {
            Self::Mgo => FuelKindCode::Mgo,
            Self::Vlsfo => FuelKindCode::Vlsfo,
            Self::Lng => FuelKindCode::Lng,
            Self::Methanol => FuelKindCode::Methanol,
            Self::Ammonia => FuelKindCode::Ammonia,
            Self::Battery | Self::OpsHybrid => FuelKindCode::Battery,
        }
    }
}

#[derive(
    Archive,
    RkyvSerialize,
    RkyvDeserialize,
    Serialize,
    Deserialize,
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
)]
pub enum NoxTier {
    TierI = 1,
    TierII = 2,
    TierIII = 3,
}

#[derive(
    Archive,
    RkyvSerialize,
    RkyvDeserialize,
    Serialize,
    Deserialize,
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
)]
pub enum IceClass {
    None,
    Ice1C,
    Ice1B,
    Ice1A,
    Ice1ASuper,
    PolarClassPc6,
}

/// All 12 IACS member societies plus explicit RMRS (non-IACS) separation.
#[derive(
    Archive,
    RkyvSerialize,
    RkyvDeserialize,
    Serialize,
    Deserialize,
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
)]
pub enum ClassSociety {
    Abs,
    Bv,
    Ccs,
    Crs,
    Dnv,
    Irs,
    Kr,
    Lr,
    Nk,
    Prs,
    Rina,
    Tl,
    RmrsNonIacs,
    OtherNonIacs,
}

impl ClassSociety {
    pub const IACS_12: [Self; 12] = [
        Self::Abs,
        Self::Bv,
        Self::Ccs,
        Self::Crs,
        Self::Dnv,
        Self::Irs,
        Self::Kr,
        Self::Lr,
        Self::Nk,
        Self::Prs,
        Self::Rina,
        Self::Tl,
    ];

    #[must_use]
    pub const fn is_iacs_member(self) -> bool {
        !matches!(self, Self::RmrsNonIacs | Self::OtherNonIacs)
    }

    #[must_use]
    pub const fn code(self) -> &'static str {
        match self {
            Self::Abs => "ABS",
            Self::Bv => "BV",
            Self::Ccs => "CCS",
            Self::Crs => "CRS",
            Self::Dnv => "DNV",
            Self::Irs => "IRS",
            Self::Kr => "KR",
            Self::Lr => "LR",
            Self::Nk => "NK",
            Self::Prs => "PRS",
            Self::Rina => "RINA",
            Self::Tl => "TL",
            Self::RmrsNonIacs => "RMRS (Non-IACS)",
            Self::OtherNonIacs => "Non-IACS",
        }
    }
}

#[derive(
    Archive,
    RkyvSerialize,
    RkyvDeserialize,
    Serialize,
    Deserialize,
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
)]
pub enum ClassStatus {
    InClass = 0,
    Suspended = 1,
    Withdrawn = 2,
}

/// 12 International Group P&I Clubs + Türk P&I + Fixed-Premium + Non-IG.
#[derive(
    Archive,
    RkyvSerialize,
    RkyvDeserialize,
    Serialize,
    Deserialize,
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
)]
pub enum PiClub {
    AmericanClub,
    Britannia,
    Gard,
    JapanPi,
    LondonPi,
    NorthStandard,
    Shipowners,
    Skuld,
    SteamshipMutual,
    SwedishClub,
    UkPi,
    WestOfEngland,
    TurkPi,
    FixedPremium,
    OtherNonIg,
}

impl PiClub {
    pub const IG_12: [Self; 12] = [
        Self::AmericanClub,
        Self::Britannia,
        Self::Gard,
        Self::JapanPi,
        Self::LondonPi,
        Self::NorthStandard,
        Self::Shipowners,
        Self::Skuld,
        Self::SteamshipMutual,
        Self::SwedishClub,
        Self::UkPi,
        Self::WestOfEngland,
    ];

    #[must_use]
    pub const fn is_ig_or_turk_pi(self) -> bool {
        !matches!(self, Self::FixedPremium | Self::OtherNonIg)
    }

    #[must_use]
    pub const fn code(self) -> &'static str {
        match self {
            Self::AmericanClub => "American Club (IG)",
            Self::Britannia => "Britannia (IG)",
            Self::Gard => "Gard (IG)",
            Self::JapanPi => "Japan P&I (IG)",
            Self::LondonPi => "London P&I (IG)",
            Self::NorthStandard => "NorthStandard (IG)",
            Self::Shipowners => "Shipowners' (IG)",
            Self::Skuld => "Skuld (IG)",
            Self::SteamshipMutual => "Steamship Mutual (IG)",
            Self::SwedishClub => "Swedish Club (IG)",
            Self::UkPi => "UK P&I (IG)",
            Self::WestOfEngland => "West of England (IG)",
            Self::TurkPi => "Turk P&I",
            Self::FixedPremium => "Fixed-Premium P&I",
            Self::OtherNonIg => "Non-IG Mutual",
        }
    }
}

#[derive(
    Archive,
    RkyvSerialize,
    RkyvDeserialize,
    Serialize,
    Deserialize,
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
)]
pub enum MouAuthority {
    ParisMou = 0,
    TokyoMou = 1,
    MedMou = 2,
    BlackSeaMou = 3,
    AbujaMou = 4,
}

#[derive(
    Archive,
    RkyvSerialize,
    RkyvDeserialize,
    Serialize,
    Deserialize,
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
)]
pub enum CiiRating {
    Exempt = 0,
    A = 1,
    B = 2,
    C = 3,
    D = 4,
    E = 5,
}

#[derive(
    Archive, RkyvSerialize, RkyvDeserialize, Serialize, Deserialize, Debug, Clone, PartialEq, Eq,
)]
pub struct FlagHistoryEntry {
    pub flag_iso2: [u8; 2],
    #[serde(with = "u64_str")]
    pub effective_from_unix_s: u64,
    #[serde(with = "u64_str")]
    pub effective_to_unix_s: u64,
    pub source_id: String,
}

#[derive(
    Archive, RkyvSerialize, RkyvDeserialize, Serialize, Deserialize, Debug, Clone, PartialEq, Eq,
)]
pub struct PortAgentEntry {
    pub port_unlocode: String,
    pub agent_name: String,
    pub gleif_lei: String,
}

#[derive(
    Archive, RkyvSerialize, RkyvDeserialize, Serialize, Deserialize, Debug, Clone, PartialEq, Eq,
)]
pub struct CorporateChain {
    pub registered_owner: String,
    pub commercial_operator: String,
    pub ism_manager_doc_holder: String,
    pub ubo_name: String,
    pub ubo_bods_id: String,
    pub gleif_lei: String,
    pub local_port_agents: Vec<PortAgentEntry>,
}

#[derive(
    Archive, RkyvSerialize, RkyvDeserialize, Serialize, Deserialize, Debug, Clone, PartialEq, Eq,
)]
pub struct ClassChain {
    pub society: ClassSociety,
    pub status: ClassStatus,
    pub annual_survey_ymd: u32,
    pub intermediate_survey_ymd: u32,
    pub special_survey_ymd: u32,
    pub conditions_of_class: u8,
    pub survey_overdue: bool,
    pub notations: Vec<String>,
}

#[derive(
    Archive, RkyvSerialize, RkyvDeserialize, Serialize, Deserialize, Debug, Clone, PartialEq, Eq,
)]
pub struct PiInsuranceChain {
    pub club: PiClub,
    pub feb20_renewal_year: u16,
    pub feb20_blue_card_active: bool,
    pub bunker_1000gt_cert: bool,
    pub clc92_2000gt_cert: bool,
    pub nairobi_wrc_300gt_cert: bool,
    pub athens_pax_cert: bool,
    pub hm_insurer: String,
    pub fdd_active: bool,
    pub jwc_war_risk_active: bool,
}

#[derive(
    Archive, RkyvSerialize, RkyvDeserialize, Serialize, Deserialize, Debug, Clone, PartialEq, Eq,
)]
pub struct StsTransferEntry {
    #[serde(with = "u64_str")]
    pub timestamp_unix_s: u64,
    #[serde(with = "i64_str")]
    pub lat_microdeg: i64,
    #[serde(with = "i64_str")]
    pub lon_microdeg: i64,
    pub partner_imo: u32,
    pub zone_name: String,
}

#[derive(
    Archive, RkyvSerialize, RkyvDeserialize, Serialize, Deserialize, Debug, Clone, PartialEq, Eq,
)]
pub struct PscInspectionEntry {
    pub authority: MouAuthority,
    pub port_unlocode: String,
    pub inspection_ymd: u32,
    pub deficiencies: u16,
    pub detained: bool,
    pub banned: bool,
}

#[derive(
    Archive, RkyvSerialize, RkyvDeserialize, Serialize, Deserialize, Debug, Clone, PartialEq, Eq,
)]
pub struct LiveAisState {
    #[serde(with = "i64_str")]
    pub lat_microdeg: i64,
    #[serde(with = "i64_str")]
    pub lon_microdeg: i64,
    pub sog_tenth_kn: u16,
    pub cog_tenth_deg: u16,
    pub heading_deg: u16,
    pub draft_mm: u32,
    pub destination: String,
    #[serde(with = "u64_str")]
    pub eta_unix_s: u64,
    #[serde(with = "u64_str")]
    pub updated_unix_s: u64,
}

/// Complete World Ship Record (`crates/caelus_atlas/src/fleet_schema.rs`),
/// stored on disk via `rkyv + memmap2` 16-byte-aligned blocks.
#[derive(
    Archive, RkyvSerialize, RkyvDeserialize, Serialize, Deserialize, Debug, Clone, PartialEq, Eq,
)]
pub struct VesselFullRecord {
    // 1. Identity & Flag History
    pub imo: u32,
    pub mmsi: u32,
    pub callsign: String,
    pub eni: Option<String>,
    pub current_name: String,
    pub former_names: Vec<String>,
    pub current_flag_iso2: [u8; 2],
    pub flag_history_5y: Vec<FlagHistoryEntry>,
    pub flag_hopping_score_bp: u16,

    // 2. Technical & Machinery
    pub vessel_type: VesselType,
    pub gt: u32,
    pub nt: u32,
    pub dwt_tons: u32,
    pub lightship_tons: u32,
    pub loa_mm: u32,
    pub lbp_mm: u32,
    pub beam_mm: u32,
    pub air_draft_mm: u32,
    pub summer_draft_mm: u32,
    pub scantling_draft_mm: u32,
    pub teu: u32,
    pub lane_meters: u32,
    pub pax_capacity: u32,
    pub reefer_plugs: u32,
    pub main_engine_kw: u32,
    pub main_engine_rpm: u16,
    pub nox_tier: NoxTier,
    pub sfoc_dg_kwh: u16,
    pub aux_gen_kw: u32,
    pub bow_thruster_kw: u32,
    pub stern_thruster_kw: u32,
    pub fuel_type: PropulsionFuel,
    pub ops_ready: bool,
    pub scrubber_fitted: bool,
    pub ice_class: IceClass,
    pub build_year: u16,
    pub shipyard: String,
    pub service_speed_centikn: u32,
    pub block_coeff_bp: u16,
    #[serde(with = "i64_str")]
    pub daily_opex_cents: i64,

    // 3. Corporate, Class & P&I Chain
    pub corporate: CorporateChain,
    pub class_chain: ClassChain,
    pub pi_chain: PiInsuranceChain,

    // 4. Live Ops, PSC & Shadow Fleet Intelligence
    pub live_ais: LiveAisState,
    pub sar_dark_signal: bool,
    pub ais_dark_gap_min: u32,
    pub sts_history: Vec<StsTransferEntry>,
    pub psc_records: Vec<PscInspectionEntry>,
    pub cii_rating: CiiRating,
    pub opensanctions_match: bool,
    pub opensanctions_id: Option<String>,
    pub opensanctions_datasets: Vec<String>,
    pub shadow_fleet_score_bp: u16,
    pub epistemic_tag: EpistemicStatus,
    pub registry_sources: Vec<String>,
}

#[derive(
    Archive, RkyvSerialize, RkyvDeserialize, Serialize, Deserialize, Debug, Clone, PartialEq, Eq,
)]
pub struct TerminalOperatorInfo {
    pub terminal_code: String,
    pub facility_name: String,
    pub company_name: String,
    pub website: String,
}

/// Global Port / Terminal Profile (UN/LOCODE + SMDG + PortWatch + WorldPop + GTFS-RT).
#[derive(
    Archive, RkyvSerialize, RkyvDeserialize, Serialize, Deserialize, Debug, Clone, PartialEq, Eq,
)]
pub struct PortFullRecord {
    pub unlocode: String,
    pub country_iso2: [u8; 2],
    pub name: String,
    pub function_code: String,
    #[serde(with = "i64_str")]
    pub lat_microdeg: i64,
    #[serde(with = "i64_str")]
    pub lon_microdeg: i64,
    pub max_depth_mm: u32,
    pub max_loa_mm: u32,
    pub max_beam_mm: u32,
    pub air_draft_limit_mm: u32,
    pub ops_shore_power: bool,
    pub portwatch_daily_calls_tenth: u32,
    pub worldpop_catchment_100m_pop: u32,
    pub gtfs_rt_intermodal_available: bool,
    pub terminals: Vec<TerminalOperatorInfo>,
    pub epistemic_tag: EpistemicStatus,
}

#[derive(
    Archive,
    RkyvSerialize,
    RkyvDeserialize,
    Serialize,
    Deserialize,
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
)]
pub enum CompanyRole {
    RegisteredOwner = 0,
    CommercialOperator = 1,
    IsmManagerDoc = 2,
    TerminalOperator = 3,
    PortAgent = 4,
    FleetGroup = 5,
}

/// Global Maritime Organization / Fleet / Agent / Terminal Operator Profile.
#[derive(
    Archive, RkyvSerialize, RkyvDeserialize, Serialize, Deserialize, Debug, Clone, PartialEq, Eq,
)]
pub struct CompanyProfile {
    pub company_id: String,
    pub imo_company_no: Option<u32>,
    pub gleif_lei: String,
    pub bods_ubo_name: String,
    pub name: String,
    pub country_iso2: [u8; 2],
    pub role: CompanyRole,
    pub opensanctions_flagged: bool,
    pub datasets: Vec<String>,
    pub fleet_imos: Vec<u32>,
    pub fleet_mmsis: Vec<u32>,
    pub primary_port_unlocode: String,
    pub epistemic_tag: EpistemicStatus,
}

/// Country / Flag-State Maritime & Regulatory Profile.
#[derive(
    Archive, RkyvSerialize, RkyvDeserialize, Serialize, Deserialize, Debug, Clone, PartialEq, Eq,
)]
pub struct CountryMaritimeProfile {
    pub iso2: [u8; 2],
    pub name: String,
    pub capital_port_unlocode: String,
    #[serde(with = "i64_str")]
    pub lat_microdeg: i64,
    #[serde(with = "i64_str")]
    pub lon_microdeg: i64,
    pub mou_authority: MouAuthority,
    pub paris_mou_list: String,
    pub cabotage_restricted: bool,
    pub eu_eea_cabotage_pool: bool,
    pub in_sox_eca: bool,
    pub in_nox_eca: bool,
    pub tonnage_tax_active: bool,
    pub unclos_ratified: bool,
    pub imo_conventions_count: u16,
    pub port_count: u32,
    pub flagged_vessel_count: u32,
}

#[derive(
    Archive,
    RkyvSerialize,
    RkyvDeserialize,
    Serialize,
    Deserialize,
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
)]
pub enum RegulationSource {
    EurLexCellar = 0,
    ImoGisis = 1,
    Unclos1982 = 2,
    ParisTokyoMou = 3,
    EmsWe = 4,
    NationalCabotage = 5,
}

/// Living Regulatory Rule Record monitored via EUR-Lex CELLAR / IMO / UNCLOS / MoU deltas.
#[derive(
    Archive, RkyvSerialize, RkyvDeserialize, Serialize, Deserialize, Debug, Clone, PartialEq, Eq,
)]
pub struct RegulationRuleRecord {
    pub rule_id: String,
    pub source: RegulationSource,
    pub jurisdiction_iso2: [u8; 2],
    pub title: String,
    pub celex_or_ref: String,
    pub min_ukc_mm: u32,
    pub max_sulfur_ppm: u32,
    pub max_air_draft_mm: u32,
    pub require_iacs: bool,
    pub require_feb20_blue_card: bool,
    pub cabotage_local_flag_only: bool,
    #[serde(with = "u64_str")]
    pub valid_from_unix_s: u64,
    #[serde(with = "u64_str")]
    pub tx_time_unix_s: u64,
    pub summary: String,
}

/// Validates the official 7-digit IMO ship identification check digit (`IMO_7 = sum(d_i * (8 - i)) mod 10`).
#[must_use]
pub const fn validate_imo_check_digit(imo: u32) -> bool {
    if imo < 1_000_000 || imo > 9_999_999 {
        return false;
    }
    let d1 = (imo / 1_000_000) % 10;
    let d2 = (imo / 100_000) % 10;
    let d3 = (imo / 10_000) % 10;
    let d4 = (imo / 1_000) % 10;
    let d5 = (imo / 100) % 10;
    let d6 = (imo / 10) % 10;
    let d7 = imo % 10;
    let weighted = d1 * 7 + d2 * 6 + d3 * 5 + d4 * 4 + d5 * 3 + d6 * 2;
    (weighted % 10) == d7
}

/// Maps an MMSI's 3-digit Maritime Identification Digits (ITU-R M.585) to an ISO 3166-1 alpha-2 country code.
#[must_use]
pub fn mmsi_mid_to_iso2(mmsi: u32) -> [u8; 2] {
    if !(200_000_000..=799_999_999).contains(&mmsi) {
        return *b"XX";
    }
    let mid = mmsi / 1_000_000;
    match mid {
        201 => *b"AL",
        202 => *b"AD",
        203 => *b"AT",
        204 => *b"PT",
        205 => *b"BE",
        206 => *b"BY",
        207 => *b"BG",
        209 | 210 | 212 => *b"CY",
        211 | 218 => *b"DE",
        215 | 229 | 248 | 249 | 256 => *b"MT",
        219 | 220 => *b"DK",
        224 | 225 => *b"ES",
        226..=228 => *b"FR",
        230 => *b"FI",
        231 => *b"FO",
        232..=235 => *b"GB",
        236 => *b"GI",
        237..=241 => *b"GR",
        242 => *b"MA",
        244..=246 => *b"NL",
        247 => *b"IT",
        250 => *b"IE",
        251 => *b"IS",
        253 => *b"LU",
        255 | 263 => *b"PT",
        257..=259 => *b"NO",
        261 => *b"PL",
        264 => *b"RO",
        265 | 266 => *b"SE",
        269 => *b"CH",
        271 => *b"TR",
        272 => *b"UA",
        273 => *b"RU",
        275 => *b"LV",
        276 => *b"EE",
        277 => *b"LT",
        278 => *b"SI",
        303 | 338 | 366..=369 => *b"US",
        304 | 305 => *b"AG",
        306 => *b"CW",
        307 => *b"AW",
        308 | 309 | 311 => *b"BS",
        310 => *b"BM",
        312 => *b"BZ",
        314 => *b"BB",
        316 => *b"CA",
        319 => *b"KY",
        339 => *b"JM",
        341 => *b"KN",
        345 => *b"MX",
        351..=357 | 370..=374 => *b"PA",
        375..=377 => *b"VC",
        378 => *b"VG",
        403 => *b"SA",
        412..=414 => *b"CN",
        416 => *b"TW",
        419 => *b"IN",
        422 => *b"IR",
        428 => *b"IL",
        431 | 432 => *b"JP",
        440 | 441 => *b"KR",
        445 => *b"KP",
        447 => *b"KW",
        457 => *b"MN",
        466 => *b"QA",
        470 | 471 => *b"AE",
        477 => *b"HK",
        503 => *b"AU",
        512 => *b"NZ",
        518 => *b"CK",
        525 => *b"ID",
        533 => *b"MY",
        538 => *b"MH",
        548 => *b"PH",
        563..=566 => *b"SG",
        567 => *b"TH",
        574 => *b"VN",
        576 | 577 => *b"VU",
        601 => *b"ZA",
        622 => *b"EG",
        636 | 637 => *b"LR",
        657 => *b"NG",
        659 => *b"NA",
        667 => *b"SL",
        671 => *b"TG",
        677 => *b"TZ",
        701 => *b"AR",
        710 => *b"BR",
        725 => *b"CL",
        730 => *b"CO",
        735 => *b"EC",
        760 => *b"PE",
        770 => *b"UY",
        775 => *b"VE",
        _ => *b"XX",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn imo_check_digit_and_mmsi_mid_lookup_are_exact() {
        assert!(validate_imo_check_digit(9552070)); // FAROMAR (Digitraffic real vessel)
        assert!(validate_imo_check_digit(9228198)); // Diamond Princess
        assert!(!validate_imo_check_digit(9228199));
        assert!(!validate_imo_check_digit(12345));

        assert_eq!(mmsi_mid_to_iso2(271044102), *b"TR");
        assert_eq!(mmsi_mid_to_iso2(240918003), *b"GR");
        assert_eq!(mmsi_mid_to_iso2(255916067), *b"PT");
        assert_eq!(mmsi_mid_to_iso2(273313020), *b"RU");

        assert_eq!(ClassSociety::IACS_12.len(), 12);
        assert!(ClassSociety::Tl.is_iacs_member());
        assert!(!ClassSociety::RmrsNonIacs.is_iacs_member());
        assert_eq!(PiClub::IG_12.len(), 12);
        assert!(PiClub::TurkPi.is_ig_or_turk_pi());
        assert!(!PiClub::FixedPremium.is_ig_or_turk_pi());
    }
}
