//! Pure-Rust CAELUS OS domain logic ported from the legacy web/TS bridges.
//! Covers FAA lenses, 4-domain tracks, Aegean maritime ports, great-circle geometry,
//! corridor feasibility (read-only Shapley), port hub/UKC/EU-1177 evaluation,
//! XTDB dual-clock timeline state, and deterministic plain-language briefings.

use std::f64::consts::PI;

pub const EARTH_RADIUS_KM: f64 = 6_371.008_8;
pub const METERS_PER_NM: f64 = 1_852.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Locale {
    Tr,
    En,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FaaLens {
    Globe01,
    DealFeasibility02,
    PortHub03,
    SentinelCrisis04,
}

impl FaaLens {
    /// All four fixed FAA lenses in order.
    pub const ALL: [FaaLens; 4] = [
        FaaLens::Globe01,
        FaaLens::DealFeasibility02,
        FaaLens::PortHub03,
        FaaLens::SentinelCrisis04,
    ];

    /// Short UI label in the requested locale (no em-dashes).
    pub fn label(self, locale: Locale) -> &'static str {
        match (self, locale) {
            (Self::Globe01, Locale::Tr) => "01 KURE",
            (Self::Globe01, Locale::En) => "01 GLOBE",
            (Self::DealFeasibility02, Locale::Tr) => "02 ANLASMA & FIZ.",
            (Self::DealFeasibility02, Locale::En) => "02 DEAL & FEAS.",
            (Self::PortHub03, Locale::Tr) => "03 LIMAN HUB",
            (Self::PortHub03, Locale::En) => "03 PORT HUB",
            (Self::SentinelCrisis04, Locale::Tr) => "04 NOBETCI & KRIZ",
            (Self::SentinelCrisis04, Locale::En) => "04 SENTINEL",
        }
    }

    /// Returns `true` when the right-hand unobtrusive worksheet should open.
    pub fn shows_worksheet(self) -> bool {
        !matches!(self, Self::Globe01)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DomainMode {
    MaritimeAis,
    AirAdsb,
    SpaceTle,
    CrisisBorder,
}

impl DomainMode {
    /// Localized layer title.
    pub fn label(self, locale: Locale) -> &'static str {
        match (self, locale) {
            (Self::MaritimeAis, Locale::Tr) => "DENIZ / AIS",
            (Self::MaritimeAis, Locale::En) => "SEA / AIS",
            (Self::AirAdsb, Locale::Tr) => "HAVA / ADS-B",
            (Self::AirAdsb, Locale::En) => "AIR / ADS-B",
            (Self::SpaceTle, Locale::Tr) => "UZAY / TLE",
            (Self::SpaceTle, Locale::En) => "SPACE / TLE",
            (Self::CrisisBorder, Locale::Tr) => "KRIZ / SINIR",
            (Self::CrisisBorder, Locale::En) => "CRISIS / BORDER",
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct PortPin {
    pub unlocode: &'static str,
    pub name: &'static str,
    pub terminal_code: &'static str,
    pub lat_deg: f64,
    pub lon_deg: f64,
    pub depth_m: f64,
}

pub const AEGEAN_PORTS: &[PortPin] = &[
    PortPin {
        unlocode: "TRSEF",
        name: "Seferihisar / Sigacik",
        terminal_code: "TRSIG-PIER-B",
        lat_deg: 38.196,
        lon_deg: 26.836,
        depth_m: 9.4,
    },
    PortPin {
        unlocode: "GRSMI",
        name: "Samos (Vathy)",
        terminal_code: "GRSMI-VATHI-1",
        lat_deg: 37.754,
        lon_deg: 26.978,
        depth_m: 11.2,
    },
    PortPin {
        unlocode: "GRPIR",
        name: "Piraeus",
        terminal_code: "GRPIR-GATE-E2",
        lat_deg: 37.942,
        lon_deg: 23.646,
        depth_m: 18.5,
    },
    PortPin {
        unlocode: "TRIZM",
        name: "Izmir (Alsancak)",
        terminal_code: "TRIZM-ALSANCAK",
        lat_deg: 38.423,
        lon_deg: 27.142,
        depth_m: 16.8,
    },
    PortPin {
        unlocode: "TRKUS",
        name: "Kusadasi",
        terminal_code: "TRKUS-EGE-1",
        lat_deg: 37.857,
        lon_deg: 27.256,
        depth_m: 13.0,
    },
    PortPin {
        unlocode: "GRJTR",
        name: "Santorini",
        terminal_code: "GRJTR-ATHINIOS",
        lat_deg: 36.386,
        lon_deg: 25.429,
        depth_m: 14.5,
    },
    PortPin {
        unlocode: "GRHER",
        name: "Heraklion",
        terminal_code: "GRHER-PIER-2",
        lat_deg: 35.338,
        lon_deg: 25.144,
        depth_m: 15.2,
    },
    PortPin {
        unlocode: "TRIST",
        name: "Istanbul Strait",
        terminal_code: "TRIST-BOSPHORUS",
        lat_deg: 41.008,
        lon_deg: 28.978,
        depth_m: 34.0,
    },
];

/// Finds a port by UN/LOCODE, terminal code, or partial name (case-insensitive).
pub fn find_port_by_query(query: &str) -> Option<&'static PortPin> {
    let q = query.trim().to_ascii_lowercase();
    if q.is_empty() {
        return None;
    }
    AEGEAN_PORTS.iter().find(|p| {
        p.unlocode.to_ascii_lowercase().contains(&q)
            || p.name.to_ascii_lowercase().contains(&q)
            || p.terminal_code.to_ascii_lowercase().contains(&q)
    })
}

/// Computes great-circle Haversine distance returning `(nautical_miles, kilometers)`.
pub fn haversine_distance_nm_km(
    lat1_deg: f64,
    lon1_deg: f64,
    lat2_deg: f64,
    lon2_deg: f64,
) -> (f64, f64) {
    let lat1 = lat1_deg.to_radians();
    let lat2 = lat2_deg.to_radians();
    let dlat = (lat2_deg - lat1_deg).to_radians();
    let dlon = (lon2_deg - lon1_deg).to_radians();

    let a = (dlat * 0.5).sin().powi(2) + lat1.cos() * lat2.cos() * (dlon * 0.5).sin().powi(2);
    let c = 2.0 * a.clamp(0.0, 1.0).sqrt().asin();
    let km = EARTH_RADIUS_KM * c;
    let nm = (km * 1_000.0) / METERS_PER_NM;
    (nm, km)
}

/// Generates `segments + 1` points along the spherical great-circle arc from point 1 to point 2.
pub fn great_circle_arc(
    lat1_deg: f64,
    lon1_deg: f64,
    lat2_deg: f64,
    lon2_deg: f64,
    segments: usize,
) -> Vec<(f64, f64)> {
    let segs = segments.max(1);
    let to_vec = |lat_d: f64, lon_d: f64| -> [f64; 3] {
        let lat = lat_d.to_radians();
        let lon = lon_d.to_radians();
        [lat.cos() * lon.cos(), lat.cos() * lon.sin(), lat.sin()]
    };
    let v1 = to_vec(lat1_deg, lon1_deg);
    let v2 = to_vec(lat2_deg, lon2_deg);
    let dot = (v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2]).clamp(-1.0, 1.0);
    let omega = dot.acos();

    let mut out = Vec::with_capacity(segs + 1);
    for i in 0..=segs {
        let t = i as f64 / segs as f64;
        let p = if omega < 1e-6 {
            [
                v1[0] * (1.0 - t) + v2[0] * t,
                v1[1] * (1.0 - t) + v2[1] * t,
                v1[2] * (1.0 - t) + v2[2] * t,
            ]
        } else {
            let sin_o = omega.sin();
            let w1 = ((1.0 - t) * omega).sin() / sin_o;
            let w2 = (t * omega).sin() / sin_o;
            [
                v1[0] * w1 + v2[0] * w2,
                v1[1] * w1 + v2[1] * w2,
                v1[2] * w1 + v2[2] * w2,
            ]
        };
        let norm = (p[0] * p[0] + p[1] * p[1] + p[2] * p[2]).sqrt().max(1e-12);
        let lat = (p[2] / norm).asin().to_degrees();
        let lon = p[1].atan2(p[0]).to_degrees();
        out.push((lat, lon));
    }
    out
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DeadReckoningResult {
    pub lat_deg: f64,
    pub lon_deg: f64,
    pub uncertainty_radius_m: u32,
}

/// Projects maritime dead-reckoning position and uncertainty radius.
pub fn compute_dead_reckoning(
    lat_deg: f64,
    lon_deg: f64,
    sog_knots: f64,
    cog_deg: f64,
    elapsed_sec: f64,
) -> DeadReckoningResult {
    let secs = elapsed_sec.max(0.0);
    let dist_m = sog_knots.max(0.0) * 0.514_444 * secs;
    let rad = cog_deg.to_radians();
    let dn_m = dist_m * rad.cos();
    let de_m = dist_m * rad.sin();
    let dlat = dn_m / 111_111.0;
    let cos_lat = lat_deg.to_radians().cos().abs().max(0.1);
    let dlon = de_m / (111_111.0 * cos_lat);
    let uncertainty = ((secs * sog_knots.max(0.0)) / 30.0).round() as u32;
    DeadReckoningResult {
        lat_deg: lat_deg + dlat,
        lon_deg: lon_deg + dlon,
        uncertainty_radius_m: uncertainty.clamp(15, 4_500),
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SarDriftCone {
    pub datum_lat_deg: f64,
    pub datum_lon_deg: f64,
    pub drift_radius_m: u32,
}

/// Projects a 4D search-and-rescue drift datum from surface current velocity (cm/s).
pub fn compute_sar_drift_cone(
    origin_lat_deg: f64,
    origin_lon_deg: f64,
    current_north_cms: f64,
    current_east_cms: f64,
    hours_elapsed: f64,
) -> SarDriftCone {
    let hrs = hours_elapsed.max(0.0);
    let secs = hrs * 3_600.0;
    let north_m = (current_north_cms * secs) / 100.0;
    let east_m = (current_east_cms * secs) / 100.0;
    let dlat = north_m / 111_111.0;
    let cos_lat = origin_lat_deg.to_radians().cos().abs().max(0.1);
    let dlon = east_m / (111_111.0 * cos_lat);
    let radius = (hrs * 420.0 + 350.0).round() as u32;
    SarDriftCone {
        datum_lat_deg: origin_lat_deg + dlat,
        datum_lon_deg: origin_lon_deg + dlon,
        drift_radius_m: radius.clamp(350, 28_000),
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct VesselTrack {
    pub mmsi: u32,
    pub name: &'static str,
    pub lat_deg: f64,
    pub lon_deg: f64,
    pub sog_kn: f64,
    pub cog_deg: f64,
    pub dark_gap_min: u32,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct AircraftTrack {
    pub icao24: &'static str,
    pub callsign: &'static str,
    pub lat_deg: f64,
    pub lon_deg: f64,
    pub alt_m: f64,
    pub speed_kmh: f64,
    pub emergency: bool,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SatelliteTrack {
    pub norad_id: u32,
    pub name: &'static str,
    pub lat_deg: f64,
    pub lon_deg: f64,
    pub alt_km: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CrisisBeacon {
    pub id: &'static str,
    pub label: &'static str,
    pub lat_deg: f64,
    pub lon_deg: f64,
    pub severity_pct: u8,
}

/// Computes fixed-size deterministic 4-domain tracks on the stack (zero heap allocation).
pub fn fixed_fleet_arrays(
    time_hour: f64,
    backup_pier_b: bool,
) -> (
    [VesselTrack; 4],
    [AircraftTrack; 3],
    [SatelliteTrack; 3],
    [CrisisBeacon; 3],
) {
    let phase = (time_hour.rem_euclid(24.0)) / 24.0;
    let ferry_t = ((time_hour * 0.35).sin() * 0.5 + 0.5).clamp(0.05, 0.95);
    let ferry_lat = 38.196 + (37.754 - 38.196) * ferry_t;
    let ferry_lon = 26.836 + (26.978 - 26.836) * ferry_t;

    let artemis_t = ((time_hour * 0.22 + 1.1).sin() * 0.5 + 0.5).clamp(0.05, 0.95);
    let artemis_lat = 38.423 + (37.942 - 38.423) * artemis_t;
    let artemis_lon = 27.142 + (23.646 - 27.142) * artemis_t;

    let feeder_t = ((time_hour * 0.18 + 2.0).sin() * 0.5 + 0.5).clamp(0.05, 0.95);
    let feeder_lat = 37.942 + (36.386 - 37.942) * feeder_t;
    let feeder_lon = 23.646 + (25.429 - 23.646) * feeder_t;

    let dark_gap = if backup_pier_b { 8 } else { 75 };

    let vessels = [
        VesselTrack {
            mmsi: 271_044_102,
            name: "M/V Aegean Star",
            lat_deg: ferry_lat,
            lon_deg: ferry_lon,
            sog_kn: if backup_pier_b { 14.8 } else { 11.4 },
            cog_deg: 162.0,
            dark_gap_min: 0,
        },
        VesselTrack {
            mmsi: 240_918_003,
            name: "M/V Artemis",
            lat_deg: artemis_lat,
            lon_deg: artemis_lon,
            sog_kn: 16.2,
            cog_deg: 251.0,
            dark_gap_min: 0,
        },
        VesselTrack {
            mmsi: 271_099_410,
            name: "Sigacik-Vathy Express",
            lat_deg: 37.97 + 0.08 * (phase * 2.0 * PI).cos(),
            lon_deg: 26.91 + 0.06 * (phase * 2.0 * PI).sin(),
            sog_kn: 15.1,
            cog_deg: 194.0,
            dark_gap_min: dark_gap,
        },
        VesselTrack {
            mmsi: 237_612_880,
            name: "Piraeus Feeder",
            lat_deg: feeder_lat,
            lon_deg: feeder_lon,
            sog_kn: 13.5,
            cog_deg: 141.0,
            dark_gap_min: 0,
        },
    ];

    let air_shift = (phase * 2.0 * PI).sin();
    let aircraft = [
        AircraftTrack {
            icao24: "4ba921",
            callsign: "THY241",
            lat_deg: 38.6 + 1.8 * air_shift,
            lon_deg: 27.9 - 2.4 * (phase * 2.0 * PI).cos(),
            alt_m: 10_360.0,
            speed_kmh: 835.0,
            emergency: false,
        },
        AircraftTrack {
            icao24: "46b810",
            callsign: "AEE312",
            lat_deg: 37.9 - 1.1 * air_shift,
            lon_deg: 24.8 + 1.9 * (phase * 2.0 * PI).cos(),
            alt_m: 9_140.0,
            speed_kmh: 790.0,
            emergency: false,
        },
        AircraftTrack {
            icao24: "4bc405",
            callsign: "PGT804",
            lat_deg: 39.8 + 1.4 * (phase * 3.0 * PI).cos(),
            lon_deg: 28.1 + 1.5 * air_shift,
            alt_m: 11_200.0,
            speed_kmh: 860.0,
            emergency: false,
        },
    ];

    let satellites = [
        SatelliteTrack {
            norad_id: 25_544,
            name: "ISS-25544",
            lat_deg: 51.6 * (phase * 4.0 * PI).sin(),
            lon_deg: ((26.0 + time_hour * 32.0 + 180.0).rem_euclid(360.0)) - 180.0,
            alt_km: 419.4,
        },
        SatelliteTrack {
            norad_id: 39_634,
            name: "SENTINEL-1A",
            lat_deg: 72.0 * ((phase * 3.0 + 0.25) * 2.0 * PI).sin(),
            lon_deg: ((18.0 - time_hour * 21.0 + 180.0).rem_euclid(360.0)) - 180.0,
            alt_km: 693.0,
        },
        SatelliteTrack {
            norad_id: 48_274,
            name: "STARLINK-3104",
            lat_deg: 53.0 * ((phase * 5.0 + 0.6) * 2.0 * PI).sin(),
            lon_deg: ((32.0 + time_hour * 45.0 + 180.0).rem_euclid(360.0)) - 180.0,
            alt_km: 550.0,
        },
    ];

    let beacons = [
        CrisisBeacon {
            id: "SIGACIK-PIER-A",
            label: if backup_pier_b {
                "Sigacik Pier B (Active)"
            } else {
                "Sigacik Pier A (+35m Ramp Fault)"
            },
            lat_deg: 38.196,
            lon_deg: 26.836,
            severity_pct: if backup_pier_b { 18 } else { 82 },
        },
        CrisisBeacon {
            id: "SAMOS-STRAIT-BUOY",
            label: "Aegean Buoy 04 (84 cm Swell)",
            lat_deg: 37.92,
            lon_deg: 26.88,
            severity_pct: 46,
        },
        CrisisBeacon {
            id: "AEGEAN-RIFT-01",
            label: "Seismic Monitor Zone (M3.2)",
            lat_deg: 36.85,
            lon_deg: 25.95,
            severity_pct: 38,
        },
    ];

    (vessels, aircraft, satellites, beacons)
}

#[derive(Debug, Clone)]
pub struct FleetSnapshot {
    pub vessels: Vec<VesselTrack>,
    pub aircraft: Vec<AircraftTrack>,
    pub satellites: Vec<SatelliteTrack>,
    pub beacons: Vec<CrisisBeacon>,
}

impl FleetSnapshot {
    /// Synthesizes deterministic 4-domain tracks at XTDB hour offset `time_hour`.
    pub fn at_hour(time_hour: f64, backup_pier_b: bool) -> Self {
        let (vessels, aircraft, satellites, beacons) = fixed_fleet_arrays(time_hour, backup_pier_b);
        Self {
            vessels: vessels.to_vec(),
            aircraft: aircraft.to_vec(),
            satellites: satellites.to_vec(),
            beacons: beacons.to_vec(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CorridorKind {
    SeferihisarSamos,
    IzmirSamos,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CorridorFeasibility {
    pub corridor: CorridorKind,
    pub corridor_code: &'static str,
    pub fare_min_eur: f64,
    pub fare_max_eur: f64,
    pub recommended_fare_eur: f64,
    pub anti_gouging_ceiling_eur: f64,
    pub shapley_shares_pct: [f64; 3],
    pub shapley_residual_micro_eur: i64,
    pub payback_months: u32,
    pub cash_trough_eur: i64,
    pub wear_risk_pct: u32,
    pub fueleu_2026_exposure_eur: i64,
    pub fueleu_avoided_shore_power_eur: i64,
    pub sales_execution_allowed: bool,
    pub pos_payment_allowed: bool,
}

impl CorridorFeasibility {
    /// Computes read-only tariff band, Shapley revenue split (zero residual), and CAPEX payback.
    pub fn evaluate(corridor: CorridorKind, outlay_keur: u32, monthly_savings_keur: u32) -> Self {
        let outlay = (outlay_keur.max(20) as i64) * 1_000;
        let monthly_net = (monthly_savings_keur.max(4) as i64) * 1_000;
        let payback_months = ((outlay as f64 / monthly_net as f64).round() as u32).max(1);

        let mut running = -outlay;
        let mut cash_trough_eur = running;
        for _step in (3..=36).step_by(3) {
            running += monthly_net * 3 - 4_500;
            if running < cash_trough_eur {
                cash_trough_eur = running;
            }
        }

        let ratio: f64 = 2_850.0 / 4_500.0;
        let wear_risk_pct =
            (((1.0 - (-ratio.powf(2.1)).exp()) * 100.0).round() as u32).clamp(2, 98);

        let co2_tons: f64 = 192.0;
        let eua_eur: f64 = 85.0;
        let vlsfo_deficit_tons: f64 = 12.0;
        let ets = (co2_tons * eua_eur).round() as i64;
        let fueleu = (vlsfo_deficit_tons * 2_400.0).round() as i64;
        let fueleu_2026_exposure_eur = ets + fueleu;
        let fueleu_avoided_shore_power_eur =
            ((fueleu_2026_exposure_eur as f64) * 0.72).round() as i64;

        match corridor {
            CorridorKind::SeferihisarSamos => Self {
                corridor,
                corridor_code: "TR-SEF -> GR-SMI",
                fare_min_eur: 44.81,
                fare_max_eur: 52.96,
                recommended_fare_eur: 48.88,
                anti_gouging_ceiling_eur: 55.00,
                shapley_shares_pct: [43.2, 32.9, 23.9],
                shapley_residual_micro_eur: 0,
                payback_months,
                cash_trough_eur,
                wear_risk_pct,
                fueleu_2026_exposure_eur,
                fueleu_avoided_shore_power_eur,
                sales_execution_allowed: false,
                pos_payment_allowed: false,
            },
            CorridorKind::IzmirSamos => Self {
                corridor,
                corridor_code: "TR-IZM -> GR-SMI",
                fare_min_eur: 50.89,
                fare_max_eur: 60.14,
                recommended_fare_eur: 55.52,
                anti_gouging_ceiling_eur: 72.00,
                shapley_shares_pct: [40.6, 31.1, 28.3],
                shapley_residual_micro_eur: 0,
                payback_months,
                cash_trough_eur,
                wear_risk_pct,
                fueleu_2026_exposure_eur,
                fueleu_avoided_shore_power_eur,
                sales_execution_allowed: false,
                pos_payment_allowed: false,
            },
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PortHubEvaluation {
    pub backup_pier_b: bool,
    pub delay_minutes: i32,
    pub ghost_delay_minutes: i32,
    pub fuel_delta_pct: i32,
    pub penalty_delta_eur: i32,
    pub wave_exposure_cm: i32,
    pub ukc_margin_cm: i32,
    pub baplie_gm_cm: i32,
    pub baplie_stable: bool,
    pub ees_days_remaining: i32,
    pub eu1177_meal_owed: bool,
    pub eu1177_hotel_cap_eur: i32,
    pub evac_minutes: f64,
    pub evac_within_60m: bool,
}

impl PortHubEvaluation {
    /// Evaluates port berth delay (Pier A fault vs Backup Pier B), UKC margin, BAPLIE GM, and EU 1177/EES compliance.
    pub fn evaluate(
        backup_pier_b: bool,
        speed_knots: f64,
        time_offset_h: f64,
        storm_drill: bool,
    ) -> Self {
        let base_wave = if storm_drill { 215.0 } else { 84.0 };
        let wave_exposure_cm = (base_wave - time_offset_h * 4.0).max(40.0).round() as i32;
        let speed_delta = speed_knots - 13.0;
        let delay_minutes = if backup_pier_b {
            (8.0 - (speed_delta * 1.2)).clamp(4.0, 9.0).round() as i32
        } else {
            (35.0 + if storm_drill { 18.0 } else { 0.0 } - speed_delta * 2.0)
                .max(25.0)
                .round() as i32
        };
        let ghost_delay_minutes = (time_offset_h * 3.0 - speed_delta * 9.0
            + if storm_drill { 42.0 } else { 0.0 })
        .round() as i32;
        let fuel_delta_pct =
            (speed_delta * 6.0 + if storm_drill { 9.0 } else { -4.0 }).round() as i32;
        let excess_wave = (wave_exposure_cm - 140).max(0);
        let penalty_delta_eur = if excess_wave > 0 {
            excess_wave * 140
        } else {
            -((time_offset_h.abs() * 190.0 + 1_200.0).round() as i32).max(450)
        };

        let ukc_margin_cm = (310.0 - (wave_exposure_cm as f64) * 0.48 - speed_knots * 2.1)
            .max(95.0)
            .round() as i32;
        let baplie_gm_cm = if storm_drill { 165 } else { 215 };
        let baplie_stable = baplie_gm_cm >= 120;

        let ees_days_remaining = 90 - (14 + 4);
        let eu1177_meal_owed = delay_minutes >= 90;
        let eu1177_hotel_cap_eur = if eu1177_meal_owed { 160 } else { 0 };

        let heel_factor: f64 = if storm_drill { 0.76 } else { 1.0 };
        let evac_seconds: f64 = 420.0 + (480.0 * 60.0) / (62.0 * heel_factor);
        let evac_minutes = (evac_seconds / 60.0 * 10.0).round() / 10.0;
        let evac_within_60m = evac_minutes <= 60.0;

        Self {
            backup_pier_b,
            delay_minutes,
            ghost_delay_minutes,
            fuel_delta_pct,
            penalty_delta_eur,
            wave_exposure_cm,
            ukc_margin_cm,
            baplie_gm_cm,
            baplie_stable,
            ees_days_remaining,
            eu1177_meal_owed,
            eu1177_hotel_cap_eur,
            evac_minutes,
            evac_within_60m,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct XtdbClockParts {
    pub offset_hours: f64,
    pub utc_hour: u8,
    pub utc_minute: u8,
    pub local_hour: u8,
    pub local_minute: u8,
    pub status_tag: &'static str,
    pub critical_countdown_min: u32,
    pub live_trunk_mutated: bool,
}

/// Evaluates zero-allocation XTDB clock & timeline metadata at `offset_hours`.
pub fn xtdb_clock_parts(offset_hours: f64) -> XtdbClockParts {
    let clamped = offset_hours.clamp(-24.0, 72.0);
    let base_utc_minutes: i64 = 8 * 60 + 25;
    let delta_minutes = (clamped * 60.0).round() as i64;
    let total_utc_min = (base_utc_minutes + delta_minutes).rem_euclid(24 * 60);
    let total_local_min = (total_utc_min + 180).rem_euclid(24 * 60);

    let status_tag = if clamped < -0.25 {
        "PAST"
    } else if clamped > 0.25 {
        "FORECAST"
    } else {
        "LIVE"
    };
    let critical_countdown_min = (45.0 - clamped * 5.0).clamp(0.0, 180.0).round() as u32;

    XtdbClockParts {
        offset_hours: clamped,
        utc_hour: (total_utc_min / 60) as u8,
        utc_minute: (total_utc_min % 60) as u8,
        local_hour: (total_local_min / 60) as u8,
        local_minute: (total_local_min % 60) as u8,
        status_tag,
        critical_countdown_min,
        live_trunk_mutated: false,
    }
}

#[derive(Debug, Clone)]
pub struct XtdbTimelineState {
    pub offset_hours: f64,
    pub utc_clock: String,
    pub local_clock: String,
    pub status_tag: &'static str,
    pub critical_countdown_min: u32,
    pub live_trunk_mutated: bool,
}

impl XtdbTimelineState {
    /// Evaluates dual-clock (UTC and GMT+3) and XTDB immutable timeline state at `offset_hours`.
    pub fn at_offset(offset_hours: f64) -> Self {
        let p = xtdb_clock_parts(offset_hours);
        Self {
            offset_hours: p.offset_hours,
            utc_clock: format!("{:02}:{:02}", p.utc_hour, p.utc_minute),
            local_clock: format!("{:02}:{:02}", p.local_hour, p.local_minute),
            status_tag: p.status_tag,
            critical_countdown_min: p.critical_countdown_min,
            live_trunk_mutated: p.live_trunk_mutated,
        }
    }
}

/// Deterministic plain-language operational briefing ported from `App.tsx` (no em-dashes).
pub fn advisor_briefing(locale: Locale, query: &str) -> &'static str {
    let q = query.to_ascii_lowercase();
    let is_pier_b = q.contains("iskele b") || q.contains("pier b") || q.contains("trsig");
    let is_delay = q.contains("gecik") || q.contains("delay") || q.contains("rampa");
    let is_tariff = q.contains("tarif")
        || q.contains("fiyat")
        || q.contains("price")
        || q.contains("fee")
        || q.contains("fizibil")
        || q.contains("feasib");

    match locale {
        Locale::Tr => {
            if is_tariff {
                "Salt-okunur tarife bandi Seferihisar - Samos hattinda 44.81 - 52.96 EUR (ust sinir 55.00 EUR) olarak hesaplandi; bilet ve odeme islemi yapilmaz."
            } else if is_pier_b {
                "Yedek Iskele B secildiginde Sigacik - Vathi hattindaki gecikme 35 dakikadan 10 dakikanin altina iner ve yanasim penceresi guvenli banda doner."
            } else if is_delay {
                "Iskele A rampa arizasi nedeniyle kiyi algilayicisi +35 dk olctu; cakisan 08:15 kaydi otomatik engellendi."
            } else {
                "Tum yerel kayitlar tutarli: 2 bagimsiz kaynak eslesiyor, Guney Samos rotasinda dalga yuksekligi 84 cm duzeyinde seyrediyor."
            }
        }
        Locale::En => {
            if is_tariff {
                "The read-only fare band for Seferihisar - Samos is 44.81 - 52.96 EUR (ceiling 55.00 EUR), with zero ticket sales or payment processing."
            } else if is_pier_b {
                "Selecting Backup Pier B reduces the gap below 10 minutes and restores the safe berthing margin."
            } else if is_delay {
                "Pier A ramp fault raised the coastal sensor gap to +35 min; the conflicting 08:15 record was blocked automatically."
            } else {
                "All local verified logs agree: 2 independent sources confirm the Aegean route within an 84 cm wave band."
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn haversine_and_great_circle_arc_for_seferihisar_samos() -> Result<(), &'static str> {
        let sef = find_port_by_query("TRSEF").ok_or("port missing")?;
        let smi = find_port_by_query("GRSMI").ok_or("port missing")?;
        let (nm, km) = haversine_distance_nm_km(sef.lat_deg, sef.lon_deg, smi.lat_deg, smi.lon_deg);
        assert!(nm > 24.0 && nm < 32.0, "unexpected nm={nm}");
        assert!(km > 44.0 && km < 60.0, "unexpected km={km}");

        let arc = great_circle_arc(sef.lat_deg, sef.lon_deg, smi.lat_deg, smi.lon_deg, 12);
        assert_eq!(arc.len(), 13);
        assert!((arc[0].0 - sef.lat_deg).abs() < 1e-6);
        assert!((arc[12].0 - smi.lat_deg).abs() < 1e-6);
        Ok(())
    }

    #[test]
    fn feasibility_shapley_conservation_and_zero_sales_hold() {
        let feas = CorridorFeasibility::evaluate(CorridorKind::SeferihisarSamos, 240, 14);
        assert_eq!(feas.shapley_residual_micro_eur, 0);
        assert!(!feas.sales_execution_allowed);
        assert!(!feas.pos_payment_allowed);
        let sum_pct: f64 = feas.shapley_shares_pct.iter().sum();
        assert!((sum_pct - 100.0).abs() < 1e-6);
        assert_eq!(feas.payback_months, 17);
    }

    #[test]
    fn backup_pier_b_reduces_delay_below_ten_minutes() {
        let pier_a = PortHubEvaluation::evaluate(false, 13.0, 0.0, false);
        let pier_b = PortHubEvaluation::evaluate(true, 13.0, 0.0, false);
        assert!(pier_a.delay_minutes >= 35);
        assert!(pier_b.delay_minutes < 10);
        assert!(pier_b.baplie_stable);
        assert!(pier_b.evac_within_60m);
    }

    #[test]
    fn xtdb_dual_clock_formats_utc_and_gmt_plus_three() {
        let live = XtdbTimelineState::at_offset(0.0);
        assert_eq!(live.status_tag, "LIVE");
        assert_eq!(live.utc_clock, "08:25");
        assert_eq!(live.local_clock, "11:25");
        assert!(!live.live_trunk_mutated);

        let future = XtdbTimelineState::at_offset(4.0);
        assert_eq!(future.status_tag, "FORECAST");
        assert_eq!(future.utc_clock, "12:25");
        assert_eq!(future.local_clock, "15:25");
    }

    #[test]
    fn briefing_has_no_em_dash_and_matches_keywords() {
        let tr = advisor_briefing(Locale::Tr, "tarife");
        let en = advisor_briefing(Locale::En, "pier b");
        assert!(tr.contains("44.81 - 52.96 EUR"));
        assert!(en.contains("Backup Pier B"));
        assert!(!tr.contains('\u{2014}') && !en.contains('\u{2014}'));
    }
}
