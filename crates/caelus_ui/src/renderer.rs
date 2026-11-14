//! Two-layer software renderer (`base_globe_cache` + `overlay` + `DirtyRect` compositing)
//! powered by `tiny-skia` for zero-WDDM memory (< 45 MiB RAM, 0% idle GPU).

use crate::coastline::COASTLINE_POLYLINES;
use crate::glyph_atlas::{draw_text, measure_text, LINE_HEIGHT};
use crate::on_demand_workers::{OnDemandWorkerKind, OnDemandWorkerManager};
use crate::radial_menu::{resolve_radial_sector, RadialSector};
use crate::spatial_cull::{cull_entities_parallel, SpatialEntity};
use crate::symbols::{draw_caelus_emblem, SymbolAtlas, SymbolId};
use crate::theme::{Palette, Pos2f, RectF, RgbaColor, ThemeMode, Vec2f};
use caelus_atlas::{LeapEntityKind, LivingAtlas};
use caelus_core::commercial_intel::{
    compute_tariff_emsr_b, evaluate_financials, evaluate_fueleu_ets, evaluate_ropax_trim,
    verify_island_quota_and_pso, FinancialInput, RopaxTrimInput,
};
use caelus_core::domain::{
    advisor_briefing, find_port_by_query, great_circle_arc, haversine_distance_nm_km,
    CorridorFeasibility, CorridorKind, DomainMode, FaaLens, Locale, PortHubEvaluation,
    XtdbClockParts, AEGEAN_PORTS,
};
use caelus_core::i18n_seven::{phrase, GlassWallStage, Locale7, UiPhrase};
use caelus_core::maritime_security::{
    evaluate_border_and_psc, screen_entity_offline, validate_fal_edifact_dcsa, FalForm, MouRegion,
};
use caelus_core::telemetry_parsers::{
    parse_aivdm_position, parse_nmea_rmc, parse_opensky_adsb, AdsbTrackFix, AisVesselFix,
    NmeaRmcFix,
};
use caelus_core::worker::{CoreParams, CoreSnapshot, HeadlessCoreHandle, WakeupCallback};
use caelus_graph::{
    compare_branches, default_desk_snapshot_path, load_desk_snapshot, save_desk_snapshot,
    search_smdg_streaming, search_unlocode_streaming, PinnedDossier, XtdbDeskStateSnapshot,
};
use caelus_ingest::{default_ring_path, load_or_init_offline_ring, MmapRingView};
use caelus_mcp::{evaluate_mutation_gate, generate_proof_to_prose_60s};
use std::time::{Duration, Instant};
use tiny_skia::{
    FillRule, LineCap, LineJoin, Paint, PathBuilder, Pixmap, PixmapMut, Rect as SkiaRect, Stroke,
    Transform,
};

pub const BOTTOM_BAR_HEIGHT: f32 = 42.0;
pub const WORKSHEET_WIDTH: f32 = 342.0;
pub const LEAP_FLIGHT_DURATION_MS: f64 = 600.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DirtyRect {
    pub x: u32,
    pub y: u32,
    pub w: u32,
    pub h: u32,
}

impl DirtyRect {
    pub const EMPTY: Self = Self {
        x: 0,
        y: 0,
        w: 0,
        h: 0,
    };

    #[inline]
    pub fn full(w: u32, h: u32) -> Self {
        Self { x: 0, y: 0, w, h }
    }

    #[inline]
    pub fn is_empty(self) -> bool {
        self.w == 0 || self.h == 0
    }

    #[inline]
    pub fn pixel_count(self) -> u64 {
        (self.w as u64) * (self.h as u64)
    }

    pub fn from_rectf(r: RectF, max_w: u32, max_h: u32) -> Self {
        if r.w <= 0.0 || r.h <= 0.0 || max_w == 0 || max_h == 0 {
            return Self::EMPTY;
        }
        let x0 = (r.x.floor() as i32).clamp(0, max_w as i32) as u32;
        let y0 = (r.y.floor() as i32).clamp(0, max_h as i32) as u32;
        let x1 = ((r.x + r.w).ceil() as i32).clamp(0, max_w as i32) as u32;
        let y1 = ((r.y + r.h).ceil() as i32).clamp(0, max_h as i32) as u32;
        if x1 <= x0 || y1 <= y0 {
            Self::EMPTY
        } else {
            Self {
                x: x0,
                y: y0,
                w: x1 - x0,
                h: y1 - y0,
            }
        }
    }

    pub fn union(self, other: Self) -> Self {
        if self.is_empty() {
            return other;
        }
        if other.is_empty() {
            return self;
        }
        let x0 = self.x.min(other.x);
        let y0 = self.y.min(other.y);
        let x1 = (self.x + self.w).max(other.x + other.w);
        let y1 = (self.y + self.h).max(other.y + other.h);
        Self {
            x: x0,
            y: y0,
            w: x1 - x0,
            h: y1 - y0,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MissionPreset {
    Bridge = 0,
    PortHub = 1,
    Feasibility = 2,
    CrisisRoom = 3,
}

impl MissionPreset {
    pub const ALL: [Self; 4] = [
        Self::Bridge,
        Self::PortHub,
        Self::Feasibility,
        Self::CrisisRoom,
    ];

    pub fn label(self, locale: Locale) -> &'static str {
        match (self, locale) {
            (Self::Bridge, Locale::Tr) => "P1 Kopru",
            (Self::Bridge, Locale::En) => "P1 Bridge",
            (Self::PortHub, Locale::Tr) => "P2 Liman",
            (Self::PortHub, Locale::En) => "P2 Hub",
            (Self::Feasibility, Locale::Tr) => "P3 Fizib",
            (Self::Feasibility, Locale::En) => "P3 Deal",
            (Self::CrisisRoom, Locale::Tr) => "P4 Kriz",
            (Self::CrisisRoom, Locale::En) => "P4 Crisis",
        }
    }
}

#[derive(Debug, Clone)]
pub struct IngestedTelemetry {
    pub label: String,
    pub lat_deg: f64,
    pub lon_deg: f64,
    pub summary: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct BaseGlobeKey {
    width: u32,
    height: u32,
    yaw_milli: i64,
    pitch_milli: i64,
    zoom_milli: i64,
    theme: ThemeMode,
    worksheet_open: bool,
    route_start_idx: usize,
    route_end_idx: usize,
    solar_slot: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FocusField {
    None,
    Leap,
    Briefing,
}

#[derive(Debug, Clone)]
pub enum HitAction {
    SelectLens(FaaLens),
    ApplyPreset(MissionPreset),
    TogglePierB,
    ToggleStormDrill,
    ToggleTheme,
    ToggleLocale,
    SelectCorridor(CorridorKind),
    AdjustOutlay(i32),
    AdjustSavings(i32),
    AdjustSpeed(f64),
    ToggleWorker(OnDemandWorkerKind),
    FocusBriefing,
    SelectPort(usize),
    RadialSector(RadialSector),
    PromoteGlassWall,
    PinDossier,
    ToggleXtdbCompare,
    ToggleShisaSign,
}

#[derive(Debug, Clone)]
pub struct HitRegion {
    pub rect: RectF,
    pub action: HitAction,
}

pub struct CaelusApp {
    // Camera & projection + 600 ms LEAP spring flight
    pub yaw_deg: f64,
    pub pitch_deg: f64,
    pub start_yaw_deg: f64,
    pub start_pitch_deg: f64,
    pub target_yaw_deg: f64,
    pub target_pitch_deg: f64,
    pub flight_started_at: Option<Instant>,
    pub zoom: f32,
    // Modes & Lenses
    pub lens: FaaLens,
    pub domain: DomainMode,
    pub locale: Locale,
    pub locale7: Locale7,
    pub glass_stage: GlassWallStage,
    pub theme: ThemeMode,
    pub active_preset: MissionPreset,
    // Route selection (two-port Haversine arc)
    pub route_start_idx: usize,
    pub route_end_idx: usize,
    // 8-way Radial Marking Menu
    pub radial_open: bool,
    pub radial_center: Pos2f,
    pub radial_drag_active: bool,
    // Jef Raskin LEAP (/) or Ctrl+K
    pub leap_open: bool,
    pub leap_query: String,
    pub leap_status: String,
    pub focus_field: FocusField,
    // XTDB Time Dial [-24.0 .. +72.0 hours]
    pub time_hour: f64,
    pub timeline_drag_active: bool,
    pub timeline_bar_rect: RectF,
    // Operational parameters
    pub backup_pier_b: bool,
    pub storm_drill: bool,
    pub speed_knots: f64,
    pub corridor: CorridorKind,
    pub outlay_keur: u32,
    pub monthly_savings_keur: u32,
    // Deterministic briefing prompt
    pub briefing_query: String,
    pub briefing_reply: String,
    // Off-thread headless worker handle & latest immutable Copy snapshot
    pub core_handle: HeadlessCoreHandle,
    pub last_submitted_params: CoreParams,
    pub snapshot: CoreSnapshot,
    pub ingested_fix: Option<IngestedTelemetry>,
    pub ingest_ring: Option<MmapRingView>,
    pub atlas: Option<LivingAtlas>,
    pub live_pin_count: usize,
    pub pinned_dossiers: Vec<PinnedDossier>,
    pub xtdb_compare_active: bool,
    pub shisa_kanko_signed: bool,
    // On-demand isolated child process launcher
    pub workers: OnDemandWorkerManager,
    // Pointer state & hit targets
    pub pointer_pos: Pos2f,
    pub primary_drag_globe: bool,
    pub primary_drag_moved: bool,
    pub drag_origin: Pos2f,
    pub hits: Vec<HitRegion>,
    pub globe_rect: RectF,
    // Two-layer software rendering caches & dirty-rect damage tracking
    symbols: SymbolAtlas,
    base_cache_key: Option<BaseGlobeKey>,
    base_pixmap: Option<Pixmap>,
    frame_pixmap: Option<Pixmap>,
    prev_overlay_rects: Vec<DirtyRect>,
    pub needs_redraw: bool,
    pub last_base_cache_hit: bool,
    pub last_damage_pixels: u64,
}

impl CaelusApp {
    pub fn new_with_wakeup(wakeup: Option<WakeupCallback>) -> Self {
        let initial_params = CoreParams::default();
        let initial_snapshot = HeadlessCoreHandle::initial_snapshot(initial_params);
        let core_handle = HeadlessCoreHandle::spawn(initial_params, wakeup);
        let ingest_ring = load_or_init_offline_ring(&default_ring_path()).ok();
        let atlas = LivingAtlas::open_default_readonly().ok();
        let live_pin_count = ingest_ring
            .as_ref()
            .and_then(|v| v.archived().ok())
            .map_or(0, |a| a.pins.len());
        let pinned_dossiers = load_desk_snapshot(&default_desk_snapshot_path())
            .map(|s| s.pinned_dossiers)
            .unwrap_or_default();
        Self {
            yaw_deg: 26.8,
            pitch_deg: 37.9,
            start_yaw_deg: 26.8,
            start_pitch_deg: 37.9,
            target_yaw_deg: 26.8,
            target_pitch_deg: 37.9,
            flight_started_at: None,
            zoom: 2.2,
            lens: FaaLens::Globe01,
            domain: DomainMode::MaritimeAis,
            locale: Locale::Tr,
            locale7: Locale7::Tr,
            glass_stage: GlassWallStage::PersonalWorkspace,
            theme: ThemeMode::SwissDay,
            active_preset: MissionPreset::Bridge,
            route_start_idx: 0,
            route_end_idx: 1,
            radial_open: false,
            radial_center: Pos2f::ZERO,
            radial_drag_active: false,
            leap_open: false,
            leap_query: String::new(),
            leap_status: String::new(),
            focus_field: FocusField::None,
            time_hour: initial_params.time_hour,
            timeline_drag_active: false,
            timeline_bar_rect: RectF::default(),
            backup_pier_b: initial_params.backup_pier_b,
            storm_drill: initial_params.storm_drill,
            speed_knots: initial_params.speed_knots,
            corridor: initial_params.corridor,
            outlay_keur: initial_params.outlay_keur,
            monthly_savings_keur: initial_params.monthly_savings_keur,
            briefing_query: String::new(),
            briefing_reply: advisor_briefing(Locale::Tr, "ozet").to_string(),
            core_handle,
            last_submitted_params: initial_params,
            snapshot: initial_snapshot,
            ingested_fix: None,
            ingest_ring,
            atlas,
            live_pin_count,
            pinned_dossiers,
            xtdb_compare_active: false,
            shisa_kanko_signed: false,
            workers: OnDemandWorkerManager::new(),
            pointer_pos: Pos2f::ZERO,
            primary_drag_globe: false,
            primary_drag_moved: false,
            drag_origin: Pos2f::ZERO,
            hits: Vec::with_capacity(48),
            globe_rect: RectF::default(),
            symbols: SymbolAtlas::build(),
            base_cache_key: None,
            base_pixmap: None,
            frame_pixmap: None,
            prev_overlay_rects: Vec::new(),
            needs_redraw: true,
            last_base_cache_hit: false,
            last_damage_pixels: 0,
        }
    }

    pub fn current_params(&self) -> CoreParams {
        CoreParams {
            time_hour: self.time_hour,
            backup_pier_b: self.backup_pier_b,
            storm_drill: self.storm_drill,
            speed_knots: self.speed_knots,
            corridor: self.corridor,
            outlay_keur: self.outlay_keur,
            monthly_savings_keur: self.monthly_savings_keur,
            tick_nonce: self.last_submitted_params.tick_nonce,
        }
    }

    pub fn submit_params_if_changed(&mut self) {
        let params = self.current_params();
        if params != self.last_submitted_params {
            self.last_submitted_params = params;
            self.core_handle.submit_params(params);
        }
        self.needs_redraw = true;
    }

    pub fn poll_snapshot(&mut self) -> bool {
        if let Some(snap) = self.core_handle.try_recv() {
            self.snapshot = snap;
            self.needs_redraw = true;
            return true;
        }
        false
    }

    /// Advances active 600 ms LEAP damped-spring camera flight. Returns true if still animating.
    pub fn step_camera_flight(&mut self, now: Instant) -> bool {
        let Some(started) = self.flight_started_at else {
            return false;
        };
        let elapsed_ms = now.saturating_duration_since(started).as_secs_f64() * 1000.0;
        let t = (elapsed_ms / LEAP_FLIGHT_DURATION_MS).clamp(0.0, 1.0);
        // Smooth cubic/critically-damped ease-out settling cleanly at t == 1.0
        let inv = 1.0 - t;
        let ease = 1.0 - inv * inv * inv;
        self.yaw_deg = self.start_yaw_deg + (self.target_yaw_deg - self.start_yaw_deg) * ease;
        self.pitch_deg =
            self.start_pitch_deg + (self.target_pitch_deg - self.start_pitch_deg) * ease;
        self.needs_redraw = true;

        if t >= 1.0 {
            self.yaw_deg = self.target_yaw_deg;
            self.pitch_deg = self.target_pitch_deg;
            self.flight_started_at = None;
            false
        } else {
            true
        }
    }

    fn begin_camera_flight(&mut self, target_lat: f64, target_lon: f64, instant_snap: bool) {
        self.target_pitch_deg = target_lat.clamp(-80.0, 80.0);
        self.target_yaw_deg = target_lon;
        if instant_snap {
            self.pitch_deg = self.target_pitch_deg;
            self.yaw_deg = self.target_yaw_deg;
            self.flight_started_at = None;
        } else {
            self.start_pitch_deg = self.pitch_deg;
            self.start_yaw_deg = self.yaw_deg;
            self.flight_started_at = Some(Instant::now());
        }
        self.needs_redraw = true;
    }

    #[inline]
    pub fn feasibility(&self) -> &CorridorFeasibility {
        &self.snapshot.feasibility
    }

    #[inline]
    pub fn hub_eval(&self) -> &PortHubEvaluation {
        &self.snapshot.hub_eval
    }

    #[inline]
    pub fn timeline(&self) -> &XtdbClockParts {
        &self.snapshot.timeline
    }

    pub fn apply_preset(&mut self, preset: MissionPreset) {
        self.active_preset = preset;
        match preset {
            MissionPreset::Bridge => {
                self.lens = FaaLens::Globe01;
                self.domain = DomainMode::MaritimeAis;
                self.storm_drill = false;
            }
            MissionPreset::PortHub => {
                self.lens = FaaLens::PortHub03;
                self.domain = DomainMode::MaritimeAis;
                self.backup_pier_b = true;
            }
            MissionPreset::Feasibility => {
                self.lens = FaaLens::DealFeasibility02;
                self.domain = DomainMode::MaritimeAis;
            }
            MissionPreset::CrisisRoom => {
                self.lens = FaaLens::SentinelCrisis04;
                self.domain = DomainMode::CrisisBorder;
                self.storm_drill = true;
            }
        }
        self.submit_params_if_changed();
    }

    pub fn apply_radial_sector(&mut self, sector: RadialSector) {
        match sector {
            RadialSector::NorthMaritimeAis => self.domain = DomainMode::MaritimeAis,
            RadialSector::NorthEastAirAdsb => self.domain = DomainMode::AirAdsb,
            RadialSector::EastSpaceTle => self.domain = DomainMode::SpaceTle,
            RadialSector::SouthEastCrisis => self.domain = DomainMode::CrisisBorder,
            RadialSector::SouthDealLens => {
                self.lens = if self.lens == FaaLens::DealFeasibility02 {
                    FaaLens::Globe01
                } else {
                    FaaLens::DealFeasibility02
                };
            }
            RadialSector::SouthWestHubLens => {
                self.lens = if self.lens == FaaLens::PortHub03 {
                    FaaLens::Globe01
                } else {
                    FaaLens::PortHub03
                };
            }
            RadialSector::WestTogglePierB => {
                self.backup_pier_b = !self.backup_pier_b;
                self.submit_params_if_changed();
            }
            RadialSector::NorthWestToggleTheme => {
                self.theme = self.theme.toggled();
            }
        }
        self.needs_redraw = true;
    }

    /// Evaluates LEAP query: jumps camera (600 ms flight or instant in headless mode)
    /// to ports/tracks or ingests raw NMEA/AIS/ADS-B telemetry.
    pub fn apply_leap_query(&mut self, query: &str, instant_snap: bool) {
        let q = query.trim();
        if q.is_empty() {
            self.leap_status.clear();
            self.needs_redraw = true;
            return;
        }
        if q.starts_with("$GPRMC") || q.starts_with("$GNRMC") {
            match parse_nmea_rmc(q) {
                Ok(NmeaRmcFix {
                    lat_deg,
                    lon_deg,
                    sog_knots,
                    cog_deg,
                    ..
                }) => {
                    self.begin_camera_flight(lat_deg, lon_deg, instant_snap);
                    self.domain = DomainMode::MaritimeAis;
                    self.leap_status = format!("NMEA OK ({lat_deg:.3}, {lon_deg:.3})");
                    self.ingested_fix = Some(IngestedTelemetry {
                        label: "NMEA RMC".to_string(),
                        lat_deg,
                        lon_deg,
                        summary: format!("{sog_knots:.1} kn | HDG {cog_deg:.0}"),
                    });
                }
                Err(err) => self.leap_status = format!("NMEA ERR: {err}"),
            }
            self.needs_redraw = true;
            return;
        }
        if q.starts_with("!AIVDM") || q.starts_with("!AIVDO") {
            match parse_aivdm_position(q) {
                Ok(AisVesselFix {
                    mmsi,
                    lat_deg,
                    lon_deg,
                    sog_knots,
                    ..
                }) => {
                    self.begin_camera_flight(lat_deg, lon_deg, instant_snap);
                    self.domain = DomainMode::MaritimeAis;
                    self.leap_status = format!("AIS MMSI {mmsi}");
                    self.ingested_fix = Some(IngestedTelemetry {
                        label: format!("AIS {mmsi}"),
                        lat_deg,
                        lon_deg,
                        summary: format!("{sog_knots:.1} kn"),
                    });
                }
                Err(err) => self.leap_status = format!("AIS ERR: {err}"),
            }
            self.needs_redraw = true;
            return;
        }
        if q.contains(',') {
            if let Ok(AdsbTrackFix {
                callsign,
                lat_deg,
                lon_deg,
                alt_m,
                is_emergency,
                ..
            }) = parse_opensky_adsb(q)
            {
                self.begin_camera_flight(lat_deg, lon_deg, instant_snap);
                self.domain = DomainMode::AirAdsb;
                self.leap_status = format!("ADS-B {callsign}");
                self.ingested_fix = Some(IngestedTelemetry {
                    label: if is_emergency {
                        format!("EMG {callsign}")
                    } else {
                        callsign
                    },
                    lat_deg,
                    lon_deg,
                    summary: format!("{alt_m:.0} m"),
                });
                self.needs_redraw = true;
                return;
            }
        }

        if let Some(port) = find_port_by_query(q) {
            self.begin_camera_flight(port.lat_deg, port.lon_deg, instant_snap);
            self.leap_status = format!("{} ({})", port.name, port.unlocode);
            return;
        }

        let ql = q.to_ascii_lowercase();
        let vessel_hit = self
            .snapshot
            .vessels
            .iter()
            .find(|v| v.name.to_ascii_lowercase().contains(&ql) || v.mmsi.to_string().contains(&ql))
            .map(|v| (v.lat_deg, v.lon_deg, v.name.to_string()));
        if let Some((lat, lon, label)) = vessel_hit {
            self.begin_camera_flight(lat, lon, instant_snap);
            self.domain = DomainMode::MaritimeAis;
            self.leap_status = label;
            return;
        }
        let ac_hit = self
            .snapshot
            .aircraft
            .iter()
            .find(|ac| ac.callsign.to_ascii_lowercase().contains(&ql) || ac.icao24.contains(&ql))
            .map(|ac| (ac.lat_deg, ac.lon_deg, ac.callsign.to_string()));
        if let Some((lat, lon, label)) = ac_hit {
            self.begin_camera_flight(lat, lon, instant_snap);
            self.domain = DomainMode::AirAdsb;
            self.leap_status = label;
            return;
        }
        let sat_hit = self
            .snapshot
            .satellites
            .iter()
            .find(|sat| {
                sat.name.to_ascii_lowercase().contains(&ql)
                    || sat.norad_id.to_string().contains(&ql)
            })
            .map(|sat| (sat.lat_deg, sat.lon_deg, sat.name.to_string()));
        if let Some((lat, lon, label)) = sat_hit {
            self.begin_camera_flight(lat, lon, instant_snap);
            self.domain = DomainMode::SpaceTle;
            self.leap_status = label;
            return;
        }
        let atlas_hit = self
            .atlas
            .as_ref()
            .and_then(|a| a.leap_search(q).ok().flatten());
        if let Some(hit) = atlas_hit {
            if let (Some(lat_u), Some(lon_u)) = (hit.lat_microdeg, hit.lon_microdeg) {
                self.begin_camera_flight(
                    (lat_u as f64) / 1_000_000.0,
                    (lon_u as f64) / 1_000_000.0,
                    instant_snap,
                );
            }
            if matches!(hit.kind, LeapEntityKind::Vessel | LeapEntityKind::Port) {
                self.domain = DomainMode::MaritimeAis;
            }
            if hit.kind == LeapEntityKind::Vessel {
                if let (Some(imo), Some(ref atlas)) = (hit.imo, &self.atlas) {
                    let orig = AEGEAN_PORTS[self.route_start_idx].unlocode;
                    let dest = AEGEAN_PORTS[self.route_end_idx].unlocode;
                    if let Ok(Some((suit, _))) = atlas.evaluate_vessel_on_ports(imo, orig, dest) {
                        let tce_eur = suit.net_tce_per_day_cents / 100;
                        let pass_tr = if suit.all_gates_passed {
                            "4/4 Uygun"
                        } else {
                            "Kapida Takildi"
                        };
                        let pass_en = if suit.all_gates_passed {
                            "4/4 Cleared"
                        } else {
                            "Blocked"
                        };
                        self.briefing_reply = match self.locale {
                            Locale::Tr => format!(
                                "{} | Rota {}->{}: {} | Net TCE: {} EUR/gun ({} us)",
                                hit.primary_label, orig, dest, pass_tr, tce_eur, hit.elapsed_us
                            ),
                            Locale::En => format!(
                                "{} | Route {}->{}: {} | Net TCE: {} EUR/day ({} us)",
                                hit.primary_label, orig, dest, pass_en, tce_eur, hit.elapsed_us
                            ),
                        };
                    }
                }
            }
            self.leap_status = hit.primary_label;
            self.needs_redraw = true;
            return;
        }
        self.leap_status = match self.locale {
            Locale::Tr => "Eslesme yok".to_string(),
            Locale::En => "No match".to_string(),
        };
        self.needs_redraw = true;
    }

    /// Commits a LEAP query on `Enter`, falling back to streaming UN/LOCODE + SMDG index
    /// (zero permanent CSV RAM cache).
    pub fn apply_leap_commit(&mut self, query: &str, instant_snap: bool) {
        self.apply_leap_query(query, instant_snap);
        let q = query.trim();
        if q.is_empty() {
            return;
        }
        let no_match = self.leap_status == "Eslesme yok" || self.leap_status == "No match";
        if no_match {
            let locodes = search_unlocode_streaming(None, q, 1);
            let smdgs = search_smdg_streaming(None, q, 1);
            if let Some(entry) = locodes.first() {
                if let (Some(lat), Some(lon)) = (entry.lat_deg, entry.lon_deg) {
                    self.begin_camera_flight(lat, lon, instant_snap);
                }
                let smdg_tag = smdgs
                    .first()
                    .map(|t| format!(" | {}", t.terminal_code))
                    .unwrap_or_default();
                self.leap_status = format!("{} ({}){}", entry.name, entry.unlocode, smdg_tag);
                self.needs_redraw = true;
            } else if let Some(term) = smdgs.first() {
                self.leap_status = format!("{} ({})", term.facility_name, term.terminal_code);
                self.needs_redraw = true;
            }
        }
    }

    /// Pins the active corridor evaluation into `PinnedDossier` + `XtdbDeskStateSnapshot` (`rkyv`).
    pub fn pin_current_dossier(&mut self) {
        if self.pinned_dossiers.len() >= 16 {
            self.pinned_dossiers.remove(0);
        }
        let idx = self.pinned_dossiers.len() + 1;
        let dos = PinnedDossier {
            id: format!("DOS-{idx:03}"),
            title: format!(
                "{} @ {:.1}kn",
                self.snapshot.feasibility.corridor_code, self.speed_knots
            ),
            corridor_code: self.snapshot.feasibility.corridor_code.to_string(),
            created_tx_ms: (self.snapshot.generation as i64) * 1000,
            pinned_npv_keur: i64::from(self.monthly_savings_keur) * 12,
            pinned_action: format!("{:?}", self.snapshot.ai_action),
            notes: if self.backup_pier_b { "PierB" } else { "PierA" }.to_string(),
        };
        self.pinned_dossiers.push(dos);
        let desk = XtdbDeskStateSnapshot {
            schema_version: 1,
            saved_tx_ms: (self.snapshot.generation as i64) * 1000,
            active_corridor: self.snapshot.feasibility.corridor_code.to_string(),
            backup_pier_b: self.backup_pier_b,
            pinned_dossiers: self.pinned_dossiers.clone(),
        };
        let _ = save_desk_snapshot(&default_desk_snapshot_path(), &desk);
        self.needs_redraw = true;
    }

    pub fn toggle_xtdb_compare(&mut self) {
        self.xtdb_compare_active = !self.xtdb_compare_active;
        self.needs_redraw = true;
    }

    pub fn toggle_shisa_kanko_sign(&mut self) {
        if self.glass_stage == GlassWallStage::FieldMission {
            self.shisa_kanko_signed = !self.shisa_kanko_signed;
        } else {
            self.shisa_kanko_signed = false;
        }
        self.needs_redraw = true;
    }

    pub fn project(&self, lat_deg: f64, lon_deg: f64, center: Pos2f, radius: f32) -> Option<Pos2f> {
        let lat = lat_deg.to_radians();
        let lon = lon_deg.to_radians();
        let lat0 = self.pitch_deg.to_radians();
        let lon0 = self.yaw_deg.to_radians();
        let dlon = lon - lon0;

        let cos_c = lat0.sin() * lat.sin() + lat0.cos() * lat.cos() * dlon.cos();
        if cos_c < 0.0 {
            return None;
        }
        let x = lat.cos() * dlon.sin();
        let y = lat0.cos() * lat.sin() - lat0.sin() * lat.cos() * dlon.cos();
        Some(Pos2f::new(
            center.x + (x as f32) * radius,
            center.y - (y as f32) * radius,
        ))
    }

    pub fn handle_hit_action(&mut self, action: HitAction) {
        match action {
            HitAction::SelectLens(lens) => {
                self.lens = lens;
                self.focus_field = FocusField::None;
            }
            HitAction::ApplyPreset(p) => self.apply_preset(p),
            HitAction::TogglePierB => {
                self.backup_pier_b = !self.backup_pier_b;
                self.submit_params_if_changed();
            }
            HitAction::ToggleStormDrill => {
                self.storm_drill = !self.storm_drill;
                self.submit_params_if_changed();
            }
            HitAction::ToggleTheme => self.theme = self.theme.toggled(),
            HitAction::ToggleLocale => {
                self.cycle_locale7();
            }
            HitAction::SelectCorridor(c) => {
                self.corridor = c;
                self.submit_params_if_changed();
            }
            HitAction::AdjustOutlay(delta) => {
                let next = (self.outlay_keur as i32 + delta).clamp(60, 600) as u32;
                self.outlay_keur = next;
                self.submit_params_if_changed();
            }
            HitAction::AdjustSavings(delta) => {
                let next = (self.monthly_savings_keur as i32 + delta).clamp(6, 40) as u32;
                self.monthly_savings_keur = next;
                self.submit_params_if_changed();
            }
            HitAction::AdjustSpeed(delta) => {
                self.speed_knots = (self.speed_knots + delta).clamp(8.0, 22.0);
                self.submit_params_if_changed();
            }
            HitAction::ToggleWorker(kind) => {
                self.workers.toggle(kind, self.locale);
            }
            HitAction::FocusBriefing => {
                self.focus_field = FocusField::Briefing;
                self.leap_open = false;
            }
            HitAction::SelectPort(idx) => {
                self.route_start_idx = self.route_end_idx;
                self.route_end_idx = idx;
            }
            HitAction::RadialSector(sector) => {
                self.apply_radial_sector(sector);
                self.radial_open = false;
            }
            HitAction::PromoteGlassWall => {
                self.glass_stage = self.glass_stage.promote_one_way();
            }
            HitAction::PinDossier => self.pin_current_dossier(),
            HitAction::ToggleXtdbCompare => self.toggle_xtdb_compare(),
            HitAction::ToggleShisaSign => self.toggle_shisa_kanko_sign(),
        }
        self.needs_redraw = true;
    }

    pub fn cycle_locale7(&mut self) {
        self.locale7 = self.locale7.next();
        self.locale = self.locale7.to_core_locale();
        self.briefing_reply = advisor_briefing(self.locale, &self.briefing_query).to_string();
        self.needs_redraw = true;
    }

    pub fn handle_primary_down(&mut self, pos: Pos2f) {
        self.pointer_pos = pos;
        if self.timeline_bar_rect.contains(pos) {
            self.timeline_drag_active = true;
            self.scrub_timeline_to_x(pos.x);
            return;
        }
        if let Some(hit) = self
            .hits
            .iter()
            .rev()
            .find(|h| h.rect.contains(pos))
            .cloned()
        {
            self.handle_hit_action(hit.action);
            return;
        }
        if self.radial_open {
            self.radial_open = false;
            self.needs_redraw = true;
        }
        self.focus_field = FocusField::None;
        if self.globe_rect.contains(pos) {
            self.primary_drag_globe = true;
            self.primary_drag_moved = false;
            self.drag_origin = pos;
        }
    }

    pub fn handle_primary_up(&mut self) {
        self.primary_drag_globe = false;
        self.timeline_drag_active = false;
    }

    pub fn handle_secondary_down(&mut self, pos: Pos2f) {
        self.pointer_pos = pos;
        self.radial_open = true;
        self.radial_center = pos;
        self.radial_drag_active = true;
        self.needs_redraw = true;
    }

    pub fn handle_secondary_up(&mut self, pos: Pos2f) {
        self.pointer_pos = pos;
        if self.radial_drag_active {
            if let Some(sector) = resolve_radial_sector(pos - self.radial_center, 24.0) {
                self.apply_radial_sector(sector);
                self.radial_open = false;
            }
            self.radial_drag_active = false;
            self.needs_redraw = true;
        }
    }

    pub fn handle_pointer_moved(&mut self, pos: Pos2f) {
        let delta = pos - self.pointer_pos;
        self.pointer_pos = pos;
        if self.timeline_drag_active {
            self.scrub_timeline_to_x(pos.x);
            return;
        }
        if self.primary_drag_globe {
            let factor = 0.25 / (self.zoom as f64);
            self.yaw_deg -= (delta.x as f64) * factor;
            self.pitch_deg = (self.pitch_deg + (delta.y as f64) * factor).clamp(-80.0, 80.0);
            self.target_yaw_deg = self.yaw_deg;
            self.target_pitch_deg = self.pitch_deg;
            self.flight_started_at = None;
            if (pos - self.drag_origin).length() > 3.0 {
                self.primary_drag_moved = true;
            }
            self.needs_redraw = true;
        } else if self.radial_open {
            self.needs_redraw = true;
        }
    }

    pub fn handle_scroll(&mut self, delta_y: f32) {
        if delta_y.abs() > 0.05 {
            self.zoom = (self.zoom * (1.0 + delta_y * 0.08)).clamp(0.65, 6.0);
            self.needs_redraw = true;
        }
    }

    fn scrub_timeline_to_x(&mut self, x: f32) {
        let r = self.timeline_bar_rect;
        if r.w <= 1.0 {
            return;
        }
        let t = ((x - r.x) / r.w).clamp(0.0, 1.0) as f64;
        self.time_hour = (-24.0 + t * 96.0).round();
        self.submit_params_if_changed();
    }

    /// Renders current frame via two-layer `base_globe_cache` + `overlay` + `DirtyRect` compositing.
    /// Returns the damage rectangles updated on the canvas.
    pub fn render_to_buffers(
        &mut self,
        width: u32,
        height: u32,
        softbuf_pixels: Option<&mut [u32]>,
    ) -> Vec<DirtyRect> {
        let w = width.max(64);
        let h = height.max(64);
        self.ensure_pixmaps(w, h);
        self.hits.clear();

        let worksheet_open = self.lens.shows_worksheet();
        let right_w = if worksheet_open { WORKSHEET_WIDTH } else { 0.0 };
        let globe_w = (w as f32 - right_w).max(160.0);
        let globe_h = (h as f32 - BOTTOM_BAR_HEIGHT).max(120.0);
        self.globe_rect = RectF::from_xywh(0.0, 0.0, globe_w, globe_h);

        let timeline_parts = *self.timeline();
        let solar_slot =
            (timeline_parts.utc_hour as u32) * 4 + (timeline_parts.utc_minute as u32) / 15;

        let key = BaseGlobeKey {
            width: w,
            height: h,
            yaw_milli: (self.yaw_deg * 1000.0).round() as i64,
            pitch_milli: (self.pitch_deg * 1000.0).round() as i64,
            zoom_milli: (self.zoom * 1000.0).round() as i64,
            theme: self.theme,
            worksheet_open,
            route_start_idx: self.route_start_idx,
            route_end_idx: self.route_end_idx,
            solar_slot,
        };

        let base_cache_hit = self.base_cache_key == Some(key);
        self.last_base_cache_hit = base_cache_hit;

        if !base_cache_hit {
            let mut base = self.base_pixmap.take().expect("base pixmap allocated");
            self.render_base_globe(&mut base.as_mut(), w, h, &timeline_parts);
            let frame = self.frame_pixmap.as_mut().expect("frame pixmap allocated");
            frame.data_mut().copy_from_slice(base.data());
            self.base_pixmap = Some(base);
            self.base_cache_key = Some(key);
        } else {
            // Fast restore ONLY previous frame's dynamic overlay dirty rectangles
            let base = self.base_pixmap.as_ref().expect("base pixmap cached");
            let frame = self.frame_pixmap.as_mut().expect("frame pixmap allocated");
            for &rect in &self.prev_overlay_rects {
                copy_rect_rgba(base.data(), frame.data_mut(), w, h, rect);
            }
        }

        let mut curr_overlay_rects = Vec::with_capacity(24);
        {
            let mut frame = self.frame_pixmap.take().expect("frame pixmap allocated");
            self.render_dynamic_overlay(&mut frame.as_mut(), w, h, &mut curr_overlay_rects);
            self.frame_pixmap = Some(frame);
        }

        let damage = if !base_cache_hit {
            vec![DirtyRect::full(w, h)]
        } else {
            coalesce_dirty_rects(&self.prev_overlay_rects, &curr_overlay_rects, w, h)
        };

        if let Some(dst_u32) = softbuf_pixels {
            let frame = self.frame_pixmap.as_ref().expect("frame pixmap allocated");
            let src = frame.data();
            for &d in &damage {
                copy_rgba_to_softbuffer(src, dst_u32, w, h, d);
            }
        }

        self.last_damage_pixels = damage.iter().map(|r| r.pixel_count()).sum();
        self.prev_overlay_rects = curr_overlay_rects;
        self.needs_redraw = false;
        damage
    }

    /// Copies the entire cached frame pixmap into a newly allocated `softbuffer` DIB buffer (`age == 0`).
    pub fn copy_full_frame_to_softbuffer(&self, dst_u32: &mut [u32], width: u32, height: u32) {
        if let Some(frame) = &self.frame_pixmap {
            if frame.width() == width && frame.height() == height {
                copy_rgba_to_softbuffer(
                    frame.data(),
                    dst_u32,
                    width,
                    height,
                    DirtyRect::full(width, height),
                );
            }
        }
    }

    fn ensure_pixmaps(&mut self, w: u32, h: u32) {
        let needs_alloc = self
            .base_pixmap
            .as_ref()
            .is_none_or(|p| p.width() != w || p.height() != h);
        if needs_alloc {
            self.base_pixmap = Pixmap::new(w, h);
            self.frame_pixmap = Pixmap::new(w, h);
            self.base_cache_key = None;
            self.prev_overlay_rects.clear();
        }
    }

    fn render_base_globe(&self, pm: &mut PixmapMut<'_>, w: u32, h: u32, timeline: &XtdbClockParts) {
        let pal = self.theme.palette();
        pm.fill(pal.canvas_bg.to_skia());

        let center = self.globe_rect.center();
        let radius = self.globe_rect.h.min(self.globe_rect.w) * 0.42 * self.zoom;

        // SpaceX circular contrast halo (two subtle concentric bands)
        stroke_circle(
            pm,
            center.x,
            center.y,
            radius + 6.0,
            2.5,
            pal.brass_accent.with_alpha(48),
        );
        stroke_circle(
            pm,
            center.x,
            center.y,
            radius + 14.0,
            1.0,
            pal.panel_border.with_alpha(96),
        );

        // Prussian blue ocean globe sphere
        fill_circle(pm, center.x, center.y, radius, pal.globe_sea);

        // Day/Night Astronomical Solar Terminator shading on the globe
        self.draw_solar_terminator(pm, center, radius, timeline, &pal);

        // Globe rim
        stroke_circle(pm, center.x, center.y, radius, 1.5, pal.globe_land);
        stroke_circle(pm, center.x, center.y, radius, 1.4, pal.ink_primary);

        // Graticules (30 deg global + 10 deg regional when zoomed in)
        let step = if self.zoom >= 1.8 { 10 } else { 30 };
        for lat_step in (-60..=60).step_by(step) {
            let mut seg = Vec::with_capacity(92);
            for lon_step in (-180..=180).step_by(4) {
                if let Some(p) = self.project(lat_step as f64, lon_step as f64, center, radius) {
                    seg.push(p);
                } else if seg.len() >= 2 {
                    stroke_polyline(pm, &seg, 0.8, pal.globe_grid);
                    seg.clear();
                } else {
                    seg.clear();
                }
            }
            if seg.len() >= 2 {
                stroke_polyline(pm, &seg, 0.8, pal.globe_grid);
            }
        }
        for lon_step in (-180..180).step_by(step) {
            let mut seg = Vec::with_capacity(48);
            for lat_step in (-84..=84).step_by(4) {
                if let Some(p) = self.project(lat_step as f64, lon_step as f64, center, radius) {
                    seg.push(p);
                } else if seg.len() >= 2 {
                    stroke_polyline(pm, &seg, 0.8, pal.globe_grid);
                    seg.clear();
                } else {
                    seg.clear();
                }
            }
            if seg.len() >= 2 {
                stroke_polyline(pm, &seg, 0.8, pal.globe_grid);
            }
        }

        // Offline Aegean & Mediterranean cartographic coastlines
        for poly in COASTLINE_POLYLINES {
            let mut seg = Vec::with_capacity(poly.len());
            for &(lat, lon) in *poly {
                if let Some(p) = self.project(lat, lon, center, radius) {
                    seg.push(p);
                } else if seg.len() >= 2 {
                    stroke_polyline(pm, &seg, 1.25, pal.globe_coast);
                    seg.clear();
                } else {
                    seg.clear();
                }
            }
            if seg.len() >= 2 {
                stroke_polyline(pm, &seg, 1.25, pal.globe_coast);
            }
        }

        // Great-circle corridor arcs
        let corridors = [(0usize, 1usize), (1usize, 2usize), (3usize, 1usize)];
        for &(a_idx, b_idx) in &corridors {
            let pa = &AEGEAN_PORTS[a_idx];
            let pb = &AEGEAN_PORTS[b_idx];
            let arc = great_circle_arc(pa.lat_deg, pa.lon_deg, pb.lat_deg, pb.lon_deg, 16);
            let pts: Vec<Pos2f> = arc
                .into_iter()
                .filter_map(|(lat, lon)| self.project(lat, lon, center, radius))
                .collect();
            if pts.len() >= 2 {
                stroke_polyline(pm, &pts, 1.8, pal.brass_accent);
            }
        }

        // Interactive two-port Haversine ruler arc
        if self.route_start_idx != self.route_end_idx {
            let rs = &AEGEAN_PORTS[self.route_start_idx];
            let re = &AEGEAN_PORTS[self.route_end_idx];
            let arc = great_circle_arc(rs.lat_deg, rs.lon_deg, re.lat_deg, re.lon_deg, 18);
            let pts: Vec<Pos2f> = arc
                .into_iter()
                .filter_map(|(lat, lon)| self.project(lat, lon, center, radius))
                .collect();
            if pts.len() >= 2 {
                stroke_polyline(pm, &pts, 2.3, pal.safe_pine);
            }
        }

        // Official CAELUS OS 3-Crescent vector emblem anchored softly in top-left corner
        draw_caelus_emblem(pm, 26.0, 24.0, 30.0, &pal);
        let _ = (w, h);
    }

    fn draw_solar_terminator(
        &self,
        pm: &mut PixmapMut<'_>,
        center: Pos2f,
        radius: f32,
        timeline: &XtdbClockParts,
        pal: &Palette,
    ) {
        let utc_hours = f64::from(timeline.utc_hour) + f64::from(timeline.utc_minute) / 60.0;
        let subsolar_lon = 180.0 - (utc_hours / 24.0) * 360.0;
        let sun_lat = 18.0_f64.to_radians();
        let sun_lon = subsolar_lon.to_radians();
        let sun_vec = [
            sun_lat.cos() * sun_lon.cos(),
            sun_lat.cos() * sun_lon.sin(),
            sun_lat.sin(),
        ];

        let mut term_pts = Vec::with_capacity(48);
        for deg in (-180..=180).step_by(8) {
            let lon_d = deg as f64;
            let dlon = (lon_d - subsolar_lon).to_radians();
            // Terminator equation: tan(lat) = -cos(dlon) / tan(sun_lat)
            let lat_r = (-dlon.cos() / sun_lat.tan().max(0.05)).atan();
            let lat_d = lat_r.to_degrees();
            if let Some(p) = self.project(lat_d, lon_d, center, radius) {
                term_pts.push(p);
            } else if term_pts.len() >= 2 {
                stroke_polyline(pm, &term_pts, 1.2, pal.brass_accent.with_alpha(150));
                term_pts.clear();
            } else {
                term_pts.clear();
            }
        }
        if term_pts.len() >= 2 {
            stroke_polyline(pm, &term_pts, 1.2, pal.brass_accent.with_alpha(150));
        }

        // Subtle night-side hemisphere markers along coarse grid inside sphere
        for lat_d in (-60..=60).step_by(15) {
            for lon_d in (-170..=170).step_by(15) {
                let lat = (lat_d as f64).to_radians();
                let lon = (lon_d as f64).to_radians();
                let pvec = [lat.cos() * lon.cos(), lat.cos() * lon.sin(), lat.sin()];
                let dot = pvec[0] * sun_vec[0] + pvec[1] * sun_vec[1] + pvec[2] * sun_vec[2];
                if dot < -0.05 {
                    if let Some(p) = self.project(lat_d as f64, lon_d as f64, center, radius) {
                        fill_circle(pm, p.x, p.y, 4.5, pal.globe_night_tint);
                    }
                }
            }
        }
    }

    fn render_dynamic_overlay(
        &mut self,
        pm: &mut PixmapMut<'_>,
        w: u32,
        h: u32,
        dirty_out: &mut Vec<DirtyRect>,
    ) {
        let pal = self.theme.palette();
        let center = self.globe_rect.center();
        let radius = self.globe_rect.h.min(self.globe_rect.w) * 0.42 * self.zoom;
        let flash_phase = ((self.time_hour.abs() * 2.0) as u64).is_multiple_of(3);

        // 1. Aegean Ports + IMO Lighthouse Flash Fl(2) 10s Rings + Clickable Hit Regions
        for (idx, pin) in AEGEAN_PORTS.iter().enumerate() {
            if let Some(p) = self.project(pin.lat_deg, pin.lon_deg, center, radius) {
                let is_selected = idx == self.route_start_idx || idx == self.route_end_idx;
                let pin_color = if is_selected {
                    pal.safe_pine
                } else {
                    pal.brass_accent
                };
                if flash_phase {
                    stroke_circle(pm, p.x, p.y, 11.0, 1.0, pin_color.with_alpha(130));
                }
                fill_circle(pm, p.x, p.y, if is_selected { 5.2 } else { 4.0 }, pin_color);
                stroke_circle(pm, p.x, p.y, 6.0, 1.0, pal.badge_text);
                self.symbols.draw_tinted(
                    pm,
                    SymbolId::Sym07PortHubCrane,
                    p.x,
                    p.y - 12.0,
                    pin_color,
                );
                let badge_rect = draw_badge(
                    pm,
                    Pos2f::new(p.x + 2.0, p.y),
                    pin.name,
                    pal.badge_bg,
                    pal.badge_text,
                    pin_color,
                );
                let combined = DirtyRect::from_rectf(
                    RectF::from_xywh(p.x - 14.0, p.y - 24.0, badge_rect.w + 32.0, 38.0),
                    w,
                    h,
                );
                push_dirty(dirty_out, combined);

                let hit_rect = RectF::from_center_size(p, 24.0, 24.0);
                self.hits.push(HitRegion {
                    rect: hit_rect,
                    action: HitAction::SelectPort(idx),
                });
            }
        }

        // 2. Active Domain Live Tracks filtered via `rayon` Frustum+H3 Spatial Culler
        let mut spatial_inputs = Vec::with_capacity(16);
        match self.domain {
            DomainMode::MaritimeAis => {
                for (i, v) in self.snapshot.vessels.iter().enumerate() {
                    spatial_inputs.push(SpatialEntity {
                        id: i as u64,
                        lat_deg: v.lat_deg,
                        lon_deg: v.lon_deg,
                        kind: 0,
                        priority: if v.dark_gap_min >= 60 { 255 } else { 180 },
                    });
                }
            }
            DomainMode::AirAdsb => {
                for (i, ac) in self.snapshot.aircraft.iter().enumerate() {
                    spatial_inputs.push(SpatialEntity {
                        id: i as u64,
                        lat_deg: ac.lat_deg,
                        lon_deg: ac.lon_deg,
                        kind: 1,
                        priority: if ac.emergency { 255 } else { 190 },
                    });
                }
            }
            DomainMode::SpaceTle => {
                for (i, sat) in self.snapshot.satellites.iter().enumerate() {
                    spatial_inputs.push(SpatialEntity {
                        id: i as u64,
                        lat_deg: sat.lat_deg,
                        lon_deg: sat.lon_deg,
                        kind: 2,
                        priority: 200,
                    });
                }
            }
            DomainMode::CrisisBorder => {
                for (i, b) in self.snapshot.beacons.iter().enumerate() {
                    spatial_inputs.push(SpatialEntity {
                        id: i as u64,
                        lat_deg: b.lat_deg,
                        lon_deg: b.lon_deg,
                        kind: 3,
                        priority: b.severity_pct,
                    });
                }
            }
        }

        let culled = cull_entities_parallel(
            &spatial_inputs,
            self.yaw_deg,
            self.pitch_deg,
            self.zoom,
            center,
            radius,
            self.globe_rect,
            64,
        );

        for item in culled {
            let idx = item.entity.id as usize;
            let p = Pos2f::new(item.screen_x, item.screen_y);
            let (sym, col, label) = match item.entity.kind {
                0 => {
                    let v = &self.snapshot.vessels[idx];
                    let c = if v.dark_gap_min >= 60 {
                        pal.alert_rust
                    } else {
                        pal.safe_pine
                    };
                    (
                        SymbolId::Sym06VesselFerry,
                        c,
                        format!("{} ({:.1} kn)", v.name, v.sog_kn),
                    )
                }
                1 => {
                    let ac = &self.snapshot.aircraft[idx];
                    let c = if ac.emergency {
                        pal.alert_rust
                    } else {
                        pal.brass_accent
                    };
                    (
                        SymbolId::Sym03AirlinerAdsb,
                        c,
                        format!("{} ({:.0} m)", ac.callsign, ac.alt_m),
                    )
                }
                2 => {
                    let sat = &self.snapshot.satellites[idx];
                    (
                        SymbolId::Sym01LeoSatellite,
                        pal.badge_text,
                        format!("{} ({:.0} km)", sat.name, sat.alt_km),
                    )
                }
                _ => {
                    let b = &self.snapshot.beacons[idx];
                    let c = if b.severity_pct >= 60 {
                        pal.alert_rust
                    } else {
                        pal.brass_accent
                    };
                    stroke_circle(pm, p.x, p.y, 13.0, 1.4, c);
                    (SymbolId::Sym13HazardSeismic, c, b.label.to_string())
                }
            };
            fill_circle(pm, p.x, p.y, 10.0, pal.badge_bg.with_alpha(215));
            stroke_circle(pm, p.x, p.y, 10.0, 1.0, col);
            self.symbols.draw_tinted(pm, sym, p.x, p.y, col);
            let br = draw_badge(
                pm,
                Pos2f::new(p.x + 6.0, p.y),
                &label,
                pal.badge_bg,
                pal.badge_text,
                col,
            );
            push_dirty(
                dirty_out,
                DirtyRect::from_rectf(
                    RectF::from_xywh(p.x - 16.0, p.y - 16.0, br.w + 38.0, 32.0),
                    w,
                    h,
                ),
            );
        }

        // 3. Ingested LEAP telemetry pin if present
        if let Some(fix) = &self.ingested_fix {
            if let Some(p) = self.project(fix.lat_deg, fix.lon_deg, center, radius) {
                fill_circle(pm, p.x, p.y, 6.0, pal.alert_rust);
                self.symbols.draw_tinted(
                    pm,
                    SymbolId::Sym14SpaceWeatherGnss,
                    p.x,
                    p.y - 14.0,
                    pal.alert_rust,
                );
                let br = draw_badge(
                    pm,
                    p,
                    &format!("{} | {}", fix.label, fix.summary),
                    pal.badge_bg,
                    pal.badge_text,
                    pal.alert_rust,
                );
                push_dirty(
                    dirty_out,
                    DirtyRect::from_rectf(
                        RectF::from_xywh(p.x - 14.0, p.y - 26.0, br.w + 30.0, 42.0),
                        w,
                        h,
                    ),
                );
            }
        }

        // 3b. Zero-copy rkyv + memmap2 ingest pins (top-24 visible pins for 0 ms cost)
        if let Some(ring_view) = &self.ingest_ring {
            if let Ok(arch) = ring_view.archived() {
                let mut drawn_ing = 0usize;
                for pin in arch.pins.iter() {
                    if drawn_ing >= 24 {
                        break;
                    }
                    let lat = pin.lat_deg.to_native();
                    let lon = pin.lon_deg.to_native();
                    if let Some(p) = self.project(lat, lon, center, radius) {
                        if self.globe_rect.contains(p) {
                            fill_circle(pm, p.x, p.y, 2.3, pal.brass_accent.with_alpha(190));
                            push_dirty(
                                dirty_out,
                                DirtyRect::from_rectf(RectF::from_center_size(p, 8.0, 8.0), w, h),
                            );
                            drawn_ing += 1;
                        }
                    }
                }
            }
        }

        // 4. Single minimalist top-left telemetry strip (zero SaaS cards)
        let rs = &AEGEAN_PORTS[self.route_start_idx];
        let re = &AEGEAN_PORTS[self.route_end_idx];
        let (route_nm, _) =
            haversine_distance_nm_km(rs.lat_deg, rs.lon_deg, re.lat_deg, re.lon_deg);
        let sentinel_txt = if self.snapshot.sentinel_alert {
            phrase(UiPhrase::SentinelWarning, self.locale7)
        } else {
            phrase(UiPhrase::SentinelCalm, self.locale7)
        };
        let top_line = format!(
            "{} | {} | {} | {}->{} {:.1} nm | {} ({}) | {} PINS/17F | CfC {:.2} VJ {:.2} AI {:?}",
            phrase(UiPhrase::AppHeader, self.locale7),
            self.lens.label(self.locale),
            self.domain.label(self.locale),
            rs.unlocode,
            re.unlocode,
            route_nm,
            sentinel_txt,
            self.snapshot.sentinel_code,
            self.live_pin_count,
            self.snapshot.cfc_anomaly,
            self.snapshot.vjepa_surprise,
            self.snapshot.ai_action
        );
        let top_col = if self.snapshot.sentinel_alert || self.snapshot.cfc_anomaly > 0.65 {
            pal.alert_rust
        } else {
            pal.ink_primary
        };
        let (tw, _) = measure_text(&top_line, 1);
        let strip_rect = RectF::from_xywh(46.0, 12.0, tw + 14.0, 18.0);
        fill_rect(pm, strip_rect, pal.panel_bg.with_alpha(215));
        stroke_rect(pm, strip_rect, 1.0, pal.panel_border);
        draw_text(pm, 52, 16, &top_line, 1, top_col, false);
        push_dirty(
            dirty_out,
            DirtyRect::from_rectf(strip_rect.expand(2.0), w, h),
        );

        // 5. Unobtrusive right worksheet (Lenses 02..04 only)
        if self.lens.shows_worksheet() {
            let panel_rect = RectF::from_xywh(
                w as f32 - WORKSHEET_WIDTH,
                0.0,
                WORKSHEET_WIDTH,
                h as f32 - BOTTOM_BAR_HEIGHT,
            );
            self.draw_worksheet_panel(pm, panel_rect, &pal);
            push_dirty(dirty_out, DirtyRect::from_rectf(panel_rect, w, h));
        }

        // 6. Braun/B&O Bottom Command Bar + mini John Harrison Chronometer + Presets
        let bar_rect = RectF::from_xywh(
            0.0,
            h as f32 - BOTTOM_BAR_HEIGHT,
            w as f32,
            BOTTOM_BAR_HEIGHT,
        );
        self.draw_bottom_bar(pm, bar_rect, &pal);
        push_dirty(dirty_out, DirtyRect::from_rectf(bar_rect, w, h));

        // 7. 8-Way Kurtenbach Radial Marking Menu
        if self.radial_open {
            let radial_rect = self.draw_radial_menu(pm, &pal);
            push_dirty(
                dirty_out,
                DirtyRect::from_rectf(radial_rect.expand(4.0), w, h),
            );
        }

        // 8. Jef Raskin LEAP overlay (/ or Ctrl+K)
        if self.leap_open {
            let leap_rect = self.draw_leap_overlay(pm, &pal);
            push_dirty(
                dirty_out,
                DirtyRect::from_rectf(leap_rect.expand(4.0), w, h),
            );
        }
    }

    fn draw_worksheet_panel(&mut self, pm: &mut PixmapMut<'_>, panel_rect: RectF, pal: &Palette) {
        fill_rect(pm, panel_rect, pal.panel_bg);
        stroke_rect(pm, panel_rect, 1.0, pal.panel_border);

        let tr = self.locale == Locale::Tr;
        let x0 = panel_rect.x + 14.0;
        let mut y = panel_rect.y + 14.0;
        let max_w = panel_rect.w - 28.0;

        self.symbols.draw_tinted(
            pm,
            SymbolId::Sym15DealMaLedger,
            x0 + 9.0,
            y + 5.0,
            pal.brass_accent,
        );
        draw_text(
            pm,
            (x0 + 24.0) as i32,
            y as i32,
            self.lens.label(self.locale),
            1,
            pal.brass_accent,
            true,
        );
        y += 20.0;
        fill_rect(pm, RectF::from_xywh(x0, y, max_w, 1.0), pal.panel_border);
        y += 10.0;

        match self.lens {
            FaaLens::Globe01 => {}
            FaaLens::DealFeasibility02 => {
                let c1 = RectF::from_xywh(x0, y, 148.0, 22.0);
                let c2 = RectF::from_xywh(x0 + 156.0, y, 148.0, 22.0);
                self.draw_button(
                    pm,
                    c1,
                    "TR-SEF -> GR-SMI",
                    self.corridor == CorridorKind::SeferihisarSamos,
                    pal,
                    HitAction::SelectCorridor(CorridorKind::SeferihisarSamos),
                );
                self.draw_button(
                    pm,
                    c2,
                    "TR-IZM -> GR-SMI",
                    self.corridor == CorridorKind::IzmirSamos,
                    pal,
                    HitAction::SelectCorridor(CorridorKind::IzmirSamos),
                );
                y += 30.0;

                let feas = *self.feasibility();
                let fare_line = format!(
                    "{}: {:.2}-{:.2} EUR (max {:.0})",
                    if tr { "Tarife" } else { "Fare" },
                    feas.fare_min_eur,
                    feas.fare_max_eur,
                    feas.anti_gouging_ceiling_eur
                );
                draw_text(
                    pm,
                    x0 as i32,
                    y as i32,
                    &fare_line,
                    1,
                    pal.ink_primary,
                    false,
                );
                y += 16.0;

                let shapley_line = format!(
                    "{}: {:.2} EUR | [{:.1}/{:.1}/{:.1}] r={}",
                    if tr { "Oneri" } else { "Rec" },
                    feas.recommended_fare_eur,
                    feas.shapley_shares_pct[0],
                    feas.shapley_shares_pct[1],
                    feas.shapley_shares_pct[2],
                    feas.shapley_residual_micro_eur
                );
                draw_text(
                    pm,
                    x0 as i32,
                    y as i32,
                    &shapley_line,
                    1,
                    pal.ink_muted,
                    false,
                );
                y += 22.0;

                // CAPEX stepper row
                draw_text(
                    pm,
                    x0 as i32,
                    (y + 4.0) as i32,
                    &format!("CAPEX: {} kEUR", self.outlay_keur),
                    1,
                    pal.ink_primary,
                    false,
                );
                self.draw_button(
                    pm,
                    RectF::from_xywh(x0 + 190.0, y, 38.0, 20.0),
                    "-20",
                    false,
                    pal,
                    HitAction::AdjustOutlay(-20),
                );
                self.draw_button(
                    pm,
                    RectF::from_xywh(x0 + 234.0, y, 38.0, 20.0),
                    "+20",
                    false,
                    pal,
                    HitAction::AdjustOutlay(20),
                );
                y += 26.0;

                // Monthly savings stepper row
                draw_text(
                    pm,
                    x0 as i32,
                    (y + 4.0) as i32,
                    &format!(
                        "{}: {} kEUR",
                        if tr { "Tasarruf" } else { "Savings" },
                        self.monthly_savings_keur
                    ),
                    1,
                    pal.ink_primary,
                    false,
                );
                self.draw_button(
                    pm,
                    RectF::from_xywh(x0 + 190.0, y, 38.0, 20.0),
                    "-2",
                    false,
                    pal,
                    HitAction::AdjustSavings(-2),
                );
                self.draw_button(
                    pm,
                    RectF::from_xywh(x0 + 234.0, y, 38.0, 20.0),
                    "+2",
                    false,
                    pal,
                    HitAction::AdjustSavings(2),
                );
                y += 28.0;

                let payback_line = format!(
                    "{}: {} ay | Trough {} EUR\nFuelEU kurtarim: {} EUR",
                    if tr { "Geri Odeme" } else { "Payback" },
                    feas.payback_months,
                    feas.cash_trough_eur,
                    feas.fueleu_avoided_shore_power_eur
                );
                draw_text(
                    pm,
                    x0 as i32,
                    y as i32,
                    &payback_line,
                    1,
                    pal.ink_primary,
                    false,
                );
                y += 32.0;

                draw_text(
                    pm,
                    x0 as i32,
                    y as i32,
                    if tr {
                        "SALT-OKUNUR: Bilet ve POS kapali."
                    } else {
                        "READ-ONLY: Ticket & POS disabled."
                    },
                    1,
                    pal.safe_pine,
                    true,
                );
                y += 18.0;

                let rs = &AEGEAN_PORTS[self.route_start_idx];
                let re = &AEGEAN_PORTS[self.route_end_idx];
                let (route_nm, _) =
                    haversine_distance_nm_km(rs.lat_deg, rs.lon_deg, re.lat_deg, re.lon_deg);
                let fin = evaluate_financials(FinancialInput {
                    capex_keur: self.outlay_keur as f64,
                    annual_opex_keur: 64.0,
                    annual_revenue_keur: (self.monthly_savings_keur as f64) * 12.0,
                    discount_rate: 0.08,
                    horizon_years: 7,
                    revenue_volatility: 0.14,
                    seed: 42,
                });
                let fueleu = evaluate_fueleu_ets(route_nm, self.speed_knots, 0.30, 80.0);
                let tariff =
                    compute_tariff_emsr_b(feas.recommended_fare_eur, 44.0, 400, 72.0, 90.0);
                let quota = verify_island_quota_and_pso("GRJTR", 6_500, 140, 7);
                let intel_txt = format!(
                    "MC NPV P10/50/90: {:.0}/{:.0}/{:.0} kE | IRR {:.1}%\nFuelEU: {:.1}/{:.1} gCO2 | ETS {:.0}E\nEMSR-b Protect: {} | Quota: {} | PSO: {}",
                    fin.mc_p10_npv,
                    fin.mc_p50_npv,
                    fin.mc_p90_npv,
                    fin.irr_pct,
                    fueleu.fuel_intensity_g_co2e_mj,
                    fueleu.target_g_co2e_mj,
                    fueleu.eu_ets_cost_eur,
                    tariff.emsr_b_protected_seats,
                    if quota.within_quota { "OK" } else { "CAP" },
                    if quota.pso_subsidy_valid { "OK" } else { "NO" }
                );
                draw_text(
                    pm,
                    x0 as i32,
                    y as i32,
                    &intel_txt,
                    1,
                    pal.ink_primary,
                    false,
                );
                y += 40.0;

                let btn_w = (max_w - 8.0) * 0.5;
                self.draw_button(
                    pm,
                    RectF::from_xywh(x0, y, btn_w, 20.0),
                    "XTDB A vs B [A]",
                    self.xtdb_compare_active,
                    pal,
                    HitAction::ToggleXtdbCompare,
                );
                self.draw_button(
                    pm,
                    RectF::from_xywh(x0 + btn_w + 8.0, y, btn_w, 20.0),
                    &format!("Pin ({}) [P]", self.pinned_dossiers.len()),
                    false,
                    pal,
                    HitAction::PinDossier,
                );
                y += 24.0;

                if self.xtdb_compare_active {
                    let branch_a = self.current_params();
                    let branch_b = CoreParams {
                        backup_pier_b: !branch_a.backup_pier_b,
                        ..branch_a
                    };
                    let cmp = compare_branches(&branch_a, &branch_b);
                    let cmp_txt = format!(
                        "A:{}kE vs B:{}kE | dDelay:{}m\ndCO2:{}kg | dUKC:{}cm | {}",
                        cmp.npv_a_keur,
                        cmp.npv_b_keur,
                        cmp.delta_delay_min,
                        cmp.delta_co2_kg,
                        cmp.delta_ukc_cm,
                        cmp.verdict_code
                    );
                    draw_text(
                        pm,
                        x0 as i32,
                        y as i32,
                        &cmp_txt,
                        1,
                        pal.brass_accent,
                        false,
                    );
                    y += 26.0;
                }
            }
            FaaLens::PortHub03 => {
                let rs = &AEGEAN_PORTS[self.route_start_idx];
                let re = &AEGEAN_PORTS[self.route_end_idx];
                let (nm, km) =
                    haversine_distance_nm_km(rs.lat_deg, rs.lon_deg, re.lat_deg, re.lon_deg);
                let eta_h = nm / self.speed_knots.max(1.0);
                draw_text(
                    pm,
                    x0 as i32,
                    y as i32,
                    &format!(
                        "{}->{}: {:.1} nm ({:.1} km) {:.2}h",
                        rs.unlocode, re.unlocode, nm, km, eta_h
                    ),
                    1,
                    pal.ink_primary,
                    false,
                );
                y += 20.0;

                draw_text(
                    pm,
                    x0 as i32,
                    (y + 4.0) as i32,
                    &format!(
                        "{}: {:.1} kn",
                        if tr { "Hiz" } else { "Speed" },
                        self.speed_knots
                    ),
                    1,
                    pal.ink_primary,
                    false,
                );
                self.draw_button(
                    pm,
                    RectF::from_xywh(x0 + 190.0, y, 38.0, 20.0),
                    "-1",
                    false,
                    pal,
                    HitAction::AdjustSpeed(-1.0),
                );
                self.draw_button(
                    pm,
                    RectF::from_xywh(x0 + 234.0, y, 38.0, 20.0),
                    "+1",
                    false,
                    pal,
                    HitAction::AdjustSpeed(1.0),
                );
                y += 26.0;

                self.draw_button(
                    pm,
                    RectF::from_xywh(x0, y, 220.0, 22.0),
                    if tr {
                        "[B] Yedek Iskele B (TRSIG-PIER-B)"
                    } else {
                        "[B] Backup Pier B (TRSIG-PIER-B)"
                    },
                    self.backup_pier_b,
                    pal,
                    HitAction::TogglePierB,
                );
                y += 26.0;

                self.draw_button(
                    pm,
                    RectF::from_xywh(x0, y, 220.0, 22.0),
                    if tr {
                        "[X] Firtina Tatbikati"
                    } else {
                        "[X] Storm Drill"
                    },
                    self.storm_drill,
                    pal,
                    HitAction::ToggleStormDrill,
                );
                y += 30.0;

                let hub = *self.hub_eval();
                let delay_col = if hub.delay_minutes < 10 {
                    pal.safe_pine
                } else {
                    pal.alert_rust
                };
                draw_text(
                    pm,
                    x0 as i32,
                    y as i32,
                    &format!(
                        "{}: {} dk (Ghost {:+} dk, {:+}% yakit)",
                        if tr { "Gecikme" } else { "Delay" },
                        hub.delay_minutes,
                        hub.ghost_delay_minutes,
                        hub.fuel_delta_pct
                    ),
                    1,
                    delay_col,
                    true,
                );
                y += 16.0;
                draw_text(
                    pm,
                    x0 as i32,
                    y as i32,
                    &format!(
                        "UKC {} cm | Dalga {} cm | GM {} cm ({})\nEES {} gun | Tahliye {:.1} dk | EU1177 {}",
                        hub.ukc_margin_cm,
                        hub.wave_exposure_cm,
                        hub.baplie_gm_cm,
                        if hub.baplie_stable { "OK" } else { "WARN" },
                        hub.ees_days_remaining,
                        hub.evac_minutes,
                        if hub.eu1177_meal_owed { "Otel" } else { "Normal" }
                    ),
                    1,
                    pal.ink_primary,
                    false,
                );
                y += 32.0;

                let fal = validate_fal_edifact_dcsa(
                    FalForm::PassengerListFal6,
                    "PAXLST",
                    AEGEAN_PORTS[self.route_end_idx].unlocode,
                    280,
                    20,
                );
                let trim = evaluate_ropax_trim(RopaxTrimInput {
                    lane_meters_used: 360.0,
                    lane_meters_cap: 450.0,
                    forward_load_tons: 200.0,
                    aft_load_tons: 196.0,
                    port_load_tons: 185.0,
                    starboard_load_tons: 188.0,
                });
                let border = evaluate_border_and_psc(
                    1.0,
                    (hub.ukc_margin_cm as f64) / 100.0,
                    MouRegion::MedMou,
                    9,
                    0,
                    true,
                );
                let gleif = screen_entity_offline("5493001KJTIIGC8Y1R12", "AEGEAN BLUE LINE", true);
                let sec_txt =
                    format!(
                    "FAL6/PAXLST: {} | Trim GM {:.2}m ({})\nEES/IACS: {}/{} | GLEIF: {} | RAIM: {}",
                    if fal.valid { "OK" } else { "FAIL" },
                    trim.gm_m,
                    if trim.stable { "STABLE" } else { "HEEL" },
                    if border.ees_etias_cleared { "CLR" } else { "HOLD" },
                    if border.iacs_e26_e27_compliant { "OK" } else { "WARN" },
                    if gleif.ubo_verified_bods { "UBO-OK" } else { "FLAG" },
                    if self.snapshot.raim_spoofed { "SPOOF" } else { "CLEAN" }
                );
                draw_text(pm, x0 as i32, y as i32, &sec_txt, 1, pal.ink_primary, false);
                y += 26.0;
            }
            FaaLens::SentinelCrisis04 => {
                let s = self.snapshot;
                let metrics = format!(
                    "1.CfC:{:.2} 2.V-JEPA:{:.2} 3.ActInf:{:?}\n4.CBF:{:?} ({}) [{}]\n5.P-bit:{:.2} 6.EGraph:{} 7.Topos:{:.0}kE\n8.CALYX:{:.2} 9.Darwin:{:.3} 10.AIXItl:{}\nRAIM WSSE:{:.1} ({}) | HAL:{:.4}mJ | Ring:{}/{}",
                    s.cfc_anomaly,
                    s.vjepa_surprise,
                    s.ai_action,
                    s.cbf_safe_action,
                    s.cbf_reason,
                    if s.cbf_clamped { "CLAMP" } else { "OK" },
                    s.pbit_energy,
                    s.egraph_equivalent_route,
                    s.topos_welfare_keur,
                    s.calyx_top_strength,
                    s.darwin_fitness,
                    s.aixitl_tag.code(),
                    s.raim_wsse_m2,
                    if s.raim_spoofed { "SPOOF" } else { "SAFE" },
                    s.hal_net_mj,
                    s.ring_len,
                    s.ring_capacity
                );
                draw_text(pm, x0 as i32, y as i32, &metrics, 1, pal.ink_primary, false);
                y += 5.0 * (LINE_HEIGHT as f32) + 4.0;

                self.draw_button(
                    pm,
                    RectF::from_xywh(x0, y, max_w, 20.0),
                    &format!(
                        "{}: {} [>]",
                        phrase(UiPhrase::GlassWallTitle, self.locale7),
                        self.glass_stage.label(self.locale7)
                    ),
                    self.glass_stage == GlassWallStage::FieldMission,
                    pal,
                    HitAction::PromoteGlassWall,
                );
                y += 24.0;

                let btn_w = (max_w - 8.0) * 0.5;
                self.draw_button(
                    pm,
                    RectF::from_xywh(x0, y, btn_w, 20.0),
                    if self.shisa_kanko_signed {
                        "Shisa Kanko: SIGNED [K]"
                    } else {
                        "Shisa Kanko: SIGN [K]"
                    },
                    self.shisa_kanko_signed,
                    pal,
                    HitAction::ToggleShisaSign,
                );
                self.draw_button(
                    pm,
                    RectF::from_xywh(x0 + btn_w + 8.0, y, btn_w, 20.0),
                    &format!("Pin ({}) [P]", self.pinned_dossiers.len()),
                    false,
                    pal,
                    HitAction::PinDossier,
                );
                y += 24.0;

                let z3_verdict = evaluate_mutation_gate(
                    true,
                    self.glass_stage,
                    self.shisa_kanko_signed,
                    s.cbf_clamped,
                    s.raim_spoofed,
                );
                let brief = generate_proof_to_prose_60s(
                    &s,
                    self.locale7,
                    self.pinned_dossiers.len(),
                    self.shisa_kanko_signed,
                    self.glass_stage,
                );
                let mcp_txt = format!(
                    "Z3: {} | 7 rmcp (dev BLOCK)\nP2P-60s: {}",
                    z3_verdict.reason_code, brief.headline
                );
                draw_text(pm, x0 as i32, y as i32, &mcp_txt, 1, pal.ink_primary, false);
                y += 26.0;

                draw_text(
                    pm,
                    x0 as i32,
                    y as i32,
                    if tr {
                        "Talep Uzerine Alt Surecler:"
                    } else {
                        "On-Demand Child Workers:"
                    },
                    1,
                    pal.brass_accent,
                    true,
                );
                y += 16.0;
                for kind in OnDemandWorkerKind::ALL {
                    let running = self.workers.is_running(kind);
                    self.draw_button(
                        pm,
                        RectF::from_xywh(x0, y, max_w, 20.0),
                        kind.label(self.locale),
                        running,
                        pal,
                        HitAction::ToggleWorker(kind),
                    );
                    y += 24.0;
                }
                if !self.workers.last_status.is_empty() {
                    draw_text(
                        pm,
                        x0 as i32,
                        y as i32,
                        &self.workers.last_status,
                        1,
                        pal.ink_muted,
                        false,
                    );
                    y += 16.0;
                }
            }
        }

        // Plain-language Operations Advisor at bottom of worksheet
        y += 6.0;
        fill_rect(pm, RectF::from_xywh(x0, y, max_w, 1.0), pal.panel_border);
        y += 8.0;
        draw_text(
            pm,
            x0 as i32,
            y as i32,
            if tr {
                "Operasyon Danismani"
            } else {
                "Operations Advisor"
            },
            1,
            pal.ink_muted,
            false,
        );
        y += 14.0;

        let input_rect = RectF::from_xywh(x0, y, max_w, 22.0);
        fill_rect(pm, input_rect, pal.canvas_bg);
        stroke_rect(
            pm,
            input_rect,
            1.2,
            if self.focus_field == FocusField::Briefing {
                pal.brass_accent
            } else {
                pal.panel_border
            },
        );
        let q_show = if self.briefing_query.is_empty() {
            if tr {
                "Sor: tarife / iskele b / gecikme"
            } else {
                "Ask: tariff / pier b / delay"
            }
        } else {
            &self.briefing_query
        };
        let q_col = if self.briefing_query.is_empty() {
            pal.ink_muted
        } else {
            pal.ink_primary
        };
        draw_text(
            pm,
            (x0 + 6.0) as i32,
            (y + 6.0) as i32,
            q_show,
            1,
            q_col,
            false,
        );
        self.hits.push(HitRegion {
            rect: input_rect,
            action: HitAction::FocusBriefing,
        });
        y += 28.0;

        let wrapped = wrap_text(&self.briefing_reply, 44);
        draw_text(pm, x0 as i32, y as i32, &wrapped, 1, pal.ink_primary, false);
    }

    fn draw_bottom_bar(&mut self, pm: &mut PixmapMut<'_>, bar_rect: RectF, pal: &Palette) {
        fill_rect(pm, bar_rect, pal.panel_bg);
        stroke_rect(pm, bar_rect, 1.0, pal.panel_border);

        let tr = self.locale == Locale::Tr;
        let mut x = 10.0;
        let y = bar_rect.y + 9.0;

        // 4 Fixed FAA Lenses
        for lens in FaaLens::ALL {
            let lbl = lens.label(self.locale);
            let (tw, _) = measure_text(lbl, 1);
            let bw = tw + 14.0;
            self.draw_button(
                pm,
                RectF::from_xywh(x, y, bw, 24.0),
                lbl,
                self.lens == lens,
                pal,
                HitAction::SelectLens(lens),
            );
            x += bw + 5.0;
        }

        // 4 Mission Presets [F1..F4 / clickable]
        x += 4.0;
        for preset in MissionPreset::ALL {
            let lbl = preset.label(self.locale);
            let (tw, _) = measure_text(lbl, 1);
            let bw = tw + 10.0;
            if x + bw < bar_rect.w - 460.0 {
                self.draw_button(
                    pm,
                    RectF::from_xywh(x, y, bw, 24.0),
                    lbl,
                    self.active_preset == preset,
                    pal,
                    HitAction::ApplyPreset(preset),
                );
                x += bw + 4.0;
            }
        }

        // Mini John Harrison Chronometer + XTDB dual-clock + Timeline Slider
        let chrono_cx = x + 14.0;
        let chrono_cy = bar_rect.y + BOTTOM_BAR_HEIGHT * 0.5;
        stroke_circle(pm, chrono_cx, chrono_cy, 10.0, 1.2, pal.brass_accent);
        let t = *self.timeline();
        let angle =
            ((t.utc_minute as f32 / 60.0) * std::f32::consts::TAU) - std::f32::consts::FRAC_PI_2;
        stroke_polyline(
            pm,
            &[
                Pos2f::new(chrono_cx, chrono_cy),
                Pos2f::new(chrono_cx + angle.cos() * 7.0, chrono_cy + angle.sin() * 7.0),
            ],
            1.4,
            pal.ink_primary,
        );
        x += 30.0;

        let clk = format!(
            "XTDB {} | UTC {:02}:{:02} | GMT+3 {:02}:{:02}",
            t.status_tag, t.utc_hour, t.utc_minute, t.local_hour, t.local_minute
        );
        let (cw, _) = measure_text(&clk, 1);
        draw_text(
            pm,
            x as i32,
            (y + 7.0) as i32,
            &clk,
            1,
            pal.ink_primary,
            false,
        );
        x += cw + 10.0;

        // Right-aligned toggles (Lang, Theme, Pier B)
        let right_margin = bar_rect.w - 10.0;
        let lang_lbl = self.locale7.code();
        let theme_lbl = match (self.theme, tr) {
            (ThemeMode::SwissDay, true) => "Gunduz",
            (ThemeMode::SwissDay, false) => "Day",
            (ThemeMode::OpenBridgeNight, true) => "Gece",
            (ThemeMode::OpenBridgeNight, false) => "Night",
        };
        let pier_lbl = if self.backup_pier_b {
            "Pier B: ON"
        } else {
            "Pier A"
        };

        let r_lang = RectF::from_xywh(right_margin - 36.0, y, 36.0, 24.0);
        let r_theme = RectF::from_xywh(r_lang.x - 62.0, y, 56.0, 24.0);
        let r_pier = RectF::from_xywh(r_theme.x - 84.0, y, 78.0, 24.0);
        self.draw_button(pm, r_lang, lang_lbl, false, pal, HitAction::ToggleLocale);
        self.draw_button(pm, r_theme, theme_lbl, false, pal, HitAction::ToggleTheme);
        self.draw_button(
            pm,
            r_pier,
            pier_lbl,
            self.backup_pier_b,
            pal,
            HitAction::TogglePierB,
        );

        // Timeline scrubber fits cleanly between clock and right buttons
        let slider_w = (r_pier.x - 14.0 - x).clamp(70.0, 160.0);
        let slider_rect = RectF::from_xywh(x, y + 4.0, slider_w, 16.0);
        self.timeline_bar_rect = slider_rect;
        fill_rect(pm, slider_rect, pal.canvas_bg);
        stroke_rect(pm, slider_rect, 1.0, pal.panel_border);
        let frac = ((self.time_hour + 24.0) / 96.0).clamp(0.0, 1.0) as f32;
        let knob_x = slider_rect.x + frac * (slider_rect.w - 8.0);
        fill_rect(
            pm,
            RectF::from_xywh(knob_x, slider_rect.y + 1.0, 8.0, slider_rect.h - 2.0),
            pal.brass_accent,
        );
    }

    fn draw_radial_menu(&mut self, pm: &mut PixmapMut<'_>, pal: &Palette) -> RectF {
        let ring_r = 96.0;
        stroke_circle(
            pm,
            self.radial_center.x,
            self.radial_center.y,
            ring_r,
            1.4,
            pal.brass_accent,
        );
        stroke_circle(
            pm,
            self.radial_center.x,
            self.radial_center.y,
            24.0,
            1.0,
            pal.panel_border,
        );

        let hovered_sector = resolve_radial_sector(self.pointer_pos - self.radial_center, 24.0);
        for sector in RadialSector::ALL {
            let angle = sector.screen_angle_rad();
            let pos = self.radial_center + Vec2f::new(angle.cos(), angle.sin()) * ring_r;
            let btn_rect = RectF::from_center_size(pos, 94.0, 24.0);
            let is_hov = hovered_sector == Some(sector) || btn_rect.contains(self.pointer_pos);
            fill_rect(
                pm,
                btn_rect,
                if is_hov { pal.globe_sea } else { pal.panel_bg },
            );
            stroke_rect(pm, btn_rect, 1.2, pal.brass_accent);
            let lbl = sector.label(self.locale);
            let (tw, _) = measure_text(lbl, 1);
            draw_text(
                pm,
                (pos.x - tw * 0.5) as i32,
                (pos.y - 5.0) as i32,
                lbl,
                1,
                if is_hov {
                    pal.badge_text
                } else {
                    pal.ink_primary
                },
                is_hov,
            );
            self.hits.push(HitRegion {
                rect: btn_rect,
                action: HitAction::RadialSector(sector),
            });
        }

        RectF::from_center_size(
            self.radial_center,
            ring_r * 2.0 + 110.0,
            ring_r * 2.0 + 44.0,
        )
    }

    fn draw_leap_overlay(&self, pm: &mut PixmapMut<'_>, pal: &Palette) -> RectF {
        let rect =
            RectF::from_center_size(Pos2f::new(self.globe_rect.center().x, 62.0), 420.0, 52.0);
        fill_rect(pm, rect, pal.panel_bg);
        stroke_rect(pm, rect, 1.5, pal.brass_accent);

        let display = if self.leap_query.is_empty() {
            "LEAP: TRSEF / GRSMI / ISS / $GPRMC / !AIVDM"
        } else {
            &self.leap_query
        };
        let col = if self.leap_query.is_empty() {
            pal.ink_muted
        } else {
            pal.ink_primary
        };
        draw_text(
            pm,
            (rect.x + 12.0) as i32,
            (rect.y + 10.0) as i32,
            display,
            1,
            col,
            false,
        );
        if !self.leap_status.is_empty() {
            draw_text(
                pm,
                (rect.x + 12.0) as i32,
                (rect.y + 30.0) as i32,
                &self.leap_status,
                1,
                pal.brass_accent,
                true,
            );
        }
        rect
    }

    fn draw_button(
        &mut self,
        pm: &mut PixmapMut<'_>,
        rect: RectF,
        label: &str,
        active: bool,
        pal: &Palette,
        action: HitAction,
    ) {
        let hovered = rect.contains(self.pointer_pos);
        let fill = if active {
            pal.globe_sea
        } else if hovered {
            pal.canvas_bg
        } else {
            pal.panel_bg
        };
        let border = if active {
            pal.brass_accent
        } else {
            pal.panel_border
        };
        let text_col = if active {
            pal.badge_text
        } else {
            pal.ink_primary
        };
        fill_rect(pm, rect, fill);
        stroke_rect(pm, rect, 1.0, border);
        let (tw, _) = measure_text(label, 1);
        draw_text(
            pm,
            (rect.x + (rect.w - tw) * 0.5) as i32,
            (rect.y + (rect.h - 10.0) * 0.5) as i32,
            label,
            1,
            text_col,
            active,
        );
        self.hits.push(HitRegion { rect, action });
    }
}

fn fill_rect(pm: &mut PixmapMut<'_>, r: RectF, color: RgbaColor) {
    if let Some(sk) = SkiaRect::from_xywh(r.x, r.y, r.w.max(0.5), r.h.max(0.5)) {
        let mut paint = Paint::default();
        paint.set_color(color.to_skia());
        pm.fill_rect(sk, &paint, Transform::identity(), None);
    }
}

fn stroke_rect(pm: &mut PixmapMut<'_>, r: RectF, width: f32, color: RgbaColor) {
    let mut pb = PathBuilder::new();
    pb.move_to(r.x, r.y);
    pb.line_to(r.x + r.w, r.y);
    pb.line_to(r.x + r.w, r.y + r.h);
    pb.line_to(r.x, r.y + r.h);
    pb.close();
    if let Some(path) = pb.finish() {
        let mut paint = Paint {
            anti_alias: true,
            ..Paint::default()
        };
        paint.set_color(color.to_skia());
        let stroke = Stroke {
            width,
            ..Stroke::default()
        };
        pm.stroke_path(&path, &paint, &stroke, Transform::identity(), None);
    }
}

fn fill_circle(pm: &mut PixmapMut<'_>, cx: f32, cy: f32, radius: f32, color: RgbaColor) {
    if let Some(path) = PathBuilder::from_circle(cx, cy, radius.max(0.5)) {
        let mut paint = Paint {
            anti_alias: true,
            ..Paint::default()
        };
        paint.set_color(color.to_skia());
        pm.fill_path(
            &path,
            &paint,
            FillRule::Winding,
            Transform::identity(),
            None,
        );
    }
}

fn stroke_circle(
    pm: &mut PixmapMut<'_>,
    cx: f32,
    cy: f32,
    radius: f32,
    width: f32,
    color: RgbaColor,
) {
    if let Some(path) = PathBuilder::from_circle(cx, cy, radius.max(0.5)) {
        let mut paint = Paint {
            anti_alias: true,
            ..Paint::default()
        };
        paint.set_color(color.to_skia());
        let stroke = Stroke {
            width,
            ..Stroke::default()
        };
        pm.stroke_path(&path, &paint, &stroke, Transform::identity(), None);
    }
}

fn stroke_polyline(pm: &mut PixmapMut<'_>, pts: &[Pos2f], width: f32, color: RgbaColor) {
    if pts.len() < 2 {
        return;
    }
    let mut pb = PathBuilder::new();
    pb.move_to(pts[0].x, pts[0].y);
    for p in &pts[1..] {
        pb.line_to(p.x, p.y);
    }
    if let Some(path) = pb.finish() {
        let mut paint = Paint {
            anti_alias: true,
            ..Paint::default()
        };
        paint.set_color(color.to_skia());
        let stroke = Stroke {
            width,
            line_cap: LineCap::Round,
            line_join: LineJoin::Round,
            ..Stroke::default()
        };
        pm.stroke_path(&path, &paint, &stroke, Transform::identity(), None);
    }
}

fn draw_badge(
    pm: &mut PixmapMut<'_>,
    anchor: Pos2f,
    text: &str,
    bg: RgbaColor,
    fg: RgbaColor,
    border: RgbaColor,
) -> RectF {
    let (tw, th) = measure_text(text, 1);
    let r = RectF::from_xywh(
        anchor.x + 8.0,
        anchor.y - (th + 6.0) * 0.5,
        tw + 10.0,
        th + 6.0,
    );
    fill_rect(pm, r, bg);
    stroke_rect(pm, r, 1.0, border);
    draw_text(
        pm,
        (r.x + 5.0) as i32,
        (r.y + 3.0) as i32,
        text,
        1,
        fg,
        false,
    );
    r
}

fn wrap_text(input: &str, max_cols: usize) -> String {
    let mut out = String::new();
    let mut col = 0usize;
    for word in input.split_whitespace() {
        let wlen = word.chars().count();
        if col > 0 && col + 1 + wlen > max_cols {
            out.push('\n');
            col = 0;
        } else if col > 0 {
            out.push(' ');
            col += 1;
        }
        out.push_str(word);
        col += wlen;
    }
    out
}

fn push_dirty(out: &mut Vec<DirtyRect>, rect: DirtyRect) {
    if !rect.is_empty() {
        out.push(rect);
    }
}

fn coalesce_dirty_rects(prev: &[DirtyRect], curr: &[DirtyRect], w: u32, h: u32) -> Vec<DirtyRect> {
    let mut all = Vec::with_capacity(prev.len() + curr.len());
    for &r in prev.iter().chain(curr.iter()) {
        if !r.is_empty() {
            let clamped = DirtyRect {
                x: r.x.min(w),
                y: r.y.min(h),
                w: r.w.min(w.saturating_sub(r.x)),
                h: r.h.min(h.saturating_sub(r.y)),
            };
            if !clamped.is_empty() {
                all.push(clamped);
            }
        }
    }
    if all.is_empty() {
        return all;
    }
    if all.len() > 20 {
        let merged = all
            .into_iter()
            .fold(DirtyRect::EMPTY, |acc, r| acc.union(r));
        return vec![merged];
    }
    all
}

fn copy_rect_rgba(src: &[u8], dst: &mut [u8], width: u32, height: u32, rect: DirtyRect) {
    let x0 = rect.x.min(width);
    let y0 = rect.y.min(height);
    let rw = rect.w.min(width.saturating_sub(x0));
    let rh = rect.h.min(height.saturating_sub(y0));
    if rw == 0 || rh == 0 {
        return;
    }
    let stride = (width as usize) * 4;
    let byte_w = (rw as usize) * 4;
    let byte_x = (x0 as usize) * 4;
    for row in y0..(y0 + rh) {
        let start = (row as usize) * stride + byte_x;
        let end = start + byte_w;
        dst[start..end].copy_from_slice(&src[start..end]);
    }
}

fn copy_rgba_to_softbuffer(
    src_rgba: &[u8],
    dst_u32: &mut [u32],
    width: u32,
    height: u32,
    rect: DirtyRect,
) {
    let x0 = rect.x.min(width);
    let y0 = rect.y.min(height);
    let rw = rect.w.min(width.saturating_sub(x0));
    let rh = rect.h.min(height.saturating_sub(y0));
    if rw == 0 || rh == 0 {
        return;
    }
    let w_usize = width as usize;
    for row in y0..(y0 + rh) {
        let row_off = (row as usize) * w_usize + (x0 as usize);
        let rgba_off = row_off * 4;
        let dst_slice = &mut dst_u32[row_off..row_off + (rw as usize)];
        let src_slice = &src_rgba[rgba_off..rgba_off + (rw as usize) * 4];
        for (out_px, px) in dst_slice.iter_mut().zip(src_slice.chunks_exact(4)) {
            *out_px = ((px[0] as u32) << 16) | ((px[1] as u32) << 8) | (px[2] as u32);
        }
    }
}

pub fn wait_until_pier_b(app: &mut CaelusApp) {
    for _ in 0..40 {
        if let Some(snap) = app.core_handle.recv_timeout(Duration::from_millis(100)) {
            app.snapshot = snap;
            if app.snapshot.params.backup_pier_b == app.backup_pier_b {
                break;
            }
        }
    }
}

/// Benchmarks 100k spatial cull + 2-layer base cache hit + dirty-rect partial blit.
pub fn run_bench_metrics() {
    let mut app = CaelusApp::new_with_wakeup(None);
    let t_cold0 = Instant::now();
    let dmg_cold = app.render_to_buffers(1280, 800, None);
    let cold_ms = t_cold0.elapsed().as_secs_f64() * 1000.0;
    assert!(!app.last_base_cache_hit);

    app.domain = DomainMode::AirAdsb;
    app.needs_redraw = true;
    let t_warm0 = Instant::now();
    let dmg_warm = app.render_to_buffers(1280, 800, None);
    let warm_ms = t_warm0.elapsed().as_secs_f64() * 1000.0;
    assert!(app.last_base_cache_hit);

    let entities: Vec<SpatialEntity> = (0..100_000u64)
        .map(|i| SpatialEntity {
            id: i,
            lat_deg: ((i % 170) as f64) - 85.0,
            lon_deg: (((i * 37) % 360) as f64) - 180.0,
            kind: (i % 4) as u8,
            priority: (i % 255) as u8,
        })
        .collect();
    let t_cull0 = Instant::now();
    let culled = cull_entities_parallel(
        &entities,
        app.yaw_deg,
        app.pitch_deg,
        app.zoom,
        Pos2f::new(470.0, 380.0),
        680.0,
        RectF::from_xywh(0.0, 0.0, 940.0, 758.0),
        320,
    );
    let cull_ms = t_cull0.elapsed().as_secs_f64() * 1000.0;

    let cold_px: u64 = dmg_cold.iter().map(|r| r.pixel_count()).sum();
    let warm_px: u64 = dmg_warm.iter().map(|r| r.pixel_count()).sum();
    let (atlas_vessels, atlas_iacs, atlas_leap_us) = if let Some(ref atlas) = app.atlas {
        let st = atlas.stats();
        let sample_imo = atlas
            .store()
            .sample_vessel_imos(1)
            .into_iter()
            .next()
            .unwrap_or(9552070);
        let _ = atlas.leap_search(&format!("IMO{sample_imo}"));
        let t_leap0 = Instant::now();
        let _ = atlas.leap_search(&format!("IMO{sample_imo}"));
        (
            st.vessel_count,
            st.iacs_count,
            t_leap0.elapsed().as_micros() as u64,
        )
    } else {
        (0, 0, 0)
    };
    println!(
        "CAELUS_BENCH_METRICS cold_ms={:.2} warm_ms={:.2} cold_px={} warm_px={} cull_100k_ms={:.2} culled_count={} atlas_vessels={} atlas_iacs={} atlas_leap_us={}",
        cold_ms, warm_ms, cold_px, warm_px, cull_ms, culled.len(), atlas_vessels, atlas_iacs, atlas_leap_us
    );
}
