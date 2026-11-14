#![forbid(unsafe_code)]
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! CAELUS OS GUI — Pure-Rust winit + softbuffer + tiny-skia zero-WDDM renderer.
//! Idle 0% GPU (`ControlFlow::Wait`), two-layer `base_globe_cache` + `DirtyRect` damage.

mod coastline;
mod glyph_atlas;
mod on_demand_workers;
mod radial_menu;
mod renderer;
mod spatial_cull;
mod symbols;
mod theme;

use crate::radial_menu::RadialSector;
use crate::renderer::{run_bench_metrics, wait_until_pier_b, CaelusApp, DirtyRect, FocusField};
use crate::theme::Pos2f;
#[cfg(test)]
use caelus_core::domain::DomainMode;
use caelus_core::domain::{advisor_briefing, FaaLens};
use caelus_core::worker::WakeupCallback;
use std::num::NonZeroU32;
use std::sync::Arc;
use std::time::{Duration, Instant};
use winit::application::ApplicationHandler;
use winit::dpi::LogicalSize;
use winit::event::{ElementState, MouseButton, MouseScrollDelta, WindowEvent};
use winit::event_loop::{ActiveEventLoop, ControlFlow, EventLoop};
use winit::keyboard::{Key, ModifiersState, NamedKey};
#[cfg(target_os = "windows")]
use winit::platform::windows::{EventLoopBuilderExtWindows, WindowAttributesExtWindows};
use winit::window::{Window, WindowId};

#[derive(Debug, Clone, Copy)]
enum UserEvent {
    CoreWakeup,
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|arg| arg == "--smoke-test") {
        run_headless_smoke_test();
        return;
    }
    if args.iter().any(|arg| arg == "--bench-metrics") {
        run_bench_metrics();
        return;
    }

    let mut builder = EventLoop::<UserEvent>::with_user_event();
    #[cfg(target_os = "windows")]
    builder.with_dpi_aware(false);
    let event_loop = builder
        .build()
        .expect("Failed to initialize winit event loop");
    let proxy = event_loop.create_proxy();
    let wakeup: WakeupCallback = Arc::new(move || {
        let _ = proxy.send_event(UserEvent::CoreWakeup);
    });

    let mut handler = CaelusWindowHandler::new(wakeup);
    if let Err(err) = event_loop.run_app(&mut handler) {
        eprintln!("CAELUS_UI event loop terminated with error: {err}");
    }
}

struct CaelusWindowHandler {
    window: Option<Arc<Window>>,
    surface: Option<softbuffer::Surface<Arc<Window>, Arc<Window>>>,
    app: CaelusApp,
    modifiers: ModifiersState,
}

impl CaelusWindowHandler {
    fn new(wakeup: WakeupCallback) -> Self {
        Self {
            window: None,
            surface: None,
            app: CaelusApp::new_with_wakeup(Some(wakeup)),
            modifiers: ModifiersState::empty(),
        }
    }

    fn request_redraw(&self) {
        if let Some(window) = &self.window {
            window.request_redraw();
        }
    }

    fn handle_key_pressed(&mut self, event: &winit::event::KeyEvent, event_loop: &ActiveEventLoop) {
        let ctrl = self.modifiers.control_key() || self.modifiers.super_key();
        let alt = self.modifiers.alt_key();

        if ctrl {
            if let Key::Character(c) = &event.logical_key {
                if c.eq_ignore_ascii_case("k") {
                    self.app.leap_open = true;
                    self.app.focus_field = FocusField::Leap;
                    self.app.leap_query.clear();
                    self.app.leap_status.clear();
                    self.app.needs_redraw = true;
                    return;
                }
                if c.eq_ignore_ascii_case("q") {
                    event_loop.exit();
                    return;
                }
            }
        }

        match &event.logical_key {
            Key::Named(NamedKey::Escape) => {
                if self.app.leap_open
                    || self.app.radial_open
                    || self.app.focus_field != FocusField::None
                {
                    self.app.leap_open = false;
                    self.app.radial_open = false;
                    self.app.radial_drag_active = false;
                    self.app.focus_field = FocusField::None;
                    self.app.needs_redraw = true;
                }
                return;
            }
            Key::Named(NamedKey::Backspace) => {
                match self.app.focus_field {
                    FocusField::Leap => {
                        self.app.leap_query.pop();
                        let q = self.app.leap_query.clone();
                        self.app.apply_leap_query(&q, false);
                        self.app.needs_redraw = true;
                    }
                    FocusField::Briefing => {
                        self.app.briefing_query.pop();
                        self.app.needs_redraw = true;
                    }
                    FocusField::None => {}
                }
                return;
            }
            Key::Named(NamedKey::Enter) => {
                match self.app.focus_field {
                    FocusField::Leap => {
                        let q = self.app.leap_query.clone();
                        self.app.apply_leap_commit(&q, false);
                        self.app.leap_open = false;
                        self.app.focus_field = FocusField::None;
                        self.app.needs_redraw = true;
                    }
                    FocusField::Briefing => {
                        let q = self.app.briefing_query.trim().to_string();
                        self.app.briefing_reply = advisor_briefing(self.app.locale, &q).to_string();
                        self.app.needs_redraw = true;
                    }
                    FocusField::None => {}
                }
                return;
            }
            Key::Named(NamedKey::Space) => {
                if self.app.focus_field == FocusField::Leap {
                    self.app.leap_query.push(' ');
                    self.app.needs_redraw = true;
                    return;
                } else if self.app.focus_field == FocusField::Briefing {
                    self.app.briefing_query.push(' ');
                    self.app.needs_redraw = true;
                    return;
                }
            }
            _ => {}
        }

        if self.app.focus_field != FocusField::None {
            if !ctrl && !alt {
                if let Some(txt) = &event.text {
                    let clean: String = txt.chars().filter(|ch| !ch.is_control()).collect();
                    if !clean.is_empty() {
                        match self.app.focus_field {
                            FocusField::Leap => {
                                self.app.leap_query.push_str(&clean);
                                let q = self.app.leap_query.clone();
                                self.app.apply_leap_query(&q, false);
                                self.app.needs_redraw = true;
                            }
                            FocusField::Briefing => {
                                self.app.briefing_query.push_str(&clean);
                                self.app.needs_redraw = true;
                            }
                            FocusField::None => {}
                        }
                    }
                }
            }
            return;
        }

        // Global non-text shortcuts
        match &event.logical_key {
            Key::Named(NamedKey::F1) => {
                self.app.lens = FaaLens::Globe01;
                self.app.needs_redraw = true;
            }
            Key::Named(NamedKey::F2) => {
                self.app.lens = FaaLens::DealFeasibility02;
                self.app.needs_redraw = true;
            }
            Key::Named(NamedKey::F3) => {
                self.app.lens = FaaLens::PortHub03;
                self.app.needs_redraw = true;
            }
            Key::Named(NamedKey::F4) => {
                self.app.lens = FaaLens::SentinelCrisis04;
                self.app.needs_redraw = true;
            }
            Key::Named(NamedKey::ArrowLeft) => {
                self.app.time_hour = (self.app.time_hour - 1.0).max(-24.0);
                self.app.submit_params_if_changed();
                self.app.needs_redraw = true;
            }
            Key::Named(NamedKey::ArrowRight) => {
                self.app.time_hour = (self.app.time_hour + 1.0).min(72.0);
                self.app.submit_params_if_changed();
                self.app.needs_redraw = true;
            }
            Key::Character(s) if !ctrl && !alt => match s.as_str() {
                "/" => {
                    self.app.leap_open = true;
                    self.app.focus_field = FocusField::Leap;
                    self.app.leap_query.clear();
                    self.app.leap_status.clear();
                    self.app.needs_redraw = true;
                }
                "1" => {
                    self.app.lens = FaaLens::Globe01;
                    self.app.needs_redraw = true;
                }
                "2" => {
                    self.app.lens = FaaLens::DealFeasibility02;
                    self.app.needs_redraw = true;
                }
                "3" => {
                    self.app.lens = FaaLens::PortHub03;
                    self.app.needs_redraw = true;
                }
                "4" => {
                    self.app.lens = FaaLens::SentinelCrisis04;
                    self.app.needs_redraw = true;
                }
                "n" | "N" => {
                    self.app.theme = self.app.theme.toggled();
                    self.app.needs_redraw = true;
                }
                "b" | "B" => {
                    self.app.backup_pier_b = !self.app.backup_pier_b;
                    self.app.submit_params_if_changed();
                    self.app.needs_redraw = true;
                }
                "x" | "X" => {
                    self.app.storm_drill = !self.app.storm_drill;
                    self.app.submit_params_if_changed();
                    self.app.needs_redraw = true;
                }
                "l" | "L" => {
                    self.app.cycle_locale7();
                }
                "a" | "A" => {
                    self.app.toggle_xtdb_compare();
                }
                "p" | "P" => {
                    self.app.pin_current_dossier();
                }
                "k" | "K" => {
                    self.app.toggle_shisa_kanko_sign();
                }
                _ => {}
            },
            _ => {}
        }
    }

    fn render_surface(&mut self) {
        let Some(window) = self.window.clone() else {
            return;
        };
        let size = window.inner_size();
        let (w, h) = (size.width, size.height);
        if w == 0 || h == 0 {
            return;
        }
        let Some(surface) = self.surface.as_mut() else {
            return;
        };
        if let (Some(nw), Some(nh)) = (NonZeroU32::new(w), NonZeroU32::new(h)) {
            let _ = surface.resize(nw, nh);
        }
        let Ok(mut buffer) = surface.buffer_mut() else {
            return;
        };

        let fresh_buffer = buffer.age() == 0;
        let damage = self.app.render_to_buffers(w, h, Some(&mut buffer));
        if fresh_buffer && !is_full_damage(&damage, w, h) {
            self.app.copy_full_frame_to_softbuffer(&mut buffer, w, h);
            let _ = buffer.present();
            return;
        }

        if damage.is_empty() {
            let _ = buffer.present_with_damage(&[]);
            return;
        }
        if is_full_damage(&damage, w, h) {
            let _ = buffer.present();
            return;
        }

        let rects: Vec<softbuffer::Rect> = damage
            .iter()
            .filter_map(|d| {
                let rw = NonZeroU32::new(d.w.min(w.saturating_sub(d.x)))?;
                let rh = NonZeroU32::new(d.h.min(h.saturating_sub(d.y)))?;
                Some(softbuffer::Rect {
                    x: d.x,
                    y: d.y,
                    width: rw,
                    height: rh,
                })
            })
            .collect();
        if rects.is_empty() {
            let _ = buffer.present();
        } else {
            let _ = buffer.present_with_damage(&rects);
        }
    }
}

fn is_full_damage(damage: &[DirtyRect], w: u32, h: u32) -> bool {
    damage.len() == 1 && damage[0] == DirtyRect::full(w, h)
}

impl ApplicationHandler<UserEvent> for CaelusWindowHandler {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if self.window.is_some() {
            return;
        }
        let attrs = Window::default_attributes()
            .with_title("CAELUS OS // AEGEAN SOVEREIGN TELEMETRY")
            .with_inner_size(LogicalSize::new(1280.0, 820.0))
            .with_min_inner_size(LogicalSize::new(960.0, 620.0));
        #[cfg(target_os = "windows")]
        let attrs = attrs.with_drag_and_drop(false);
        let window = Arc::new(
            event_loop
                .create_window(attrs)
                .expect("Failed to create CAELUS OS window"),
        );
        let context =
            softbuffer::Context::new(Arc::clone(&window)).expect("softbuffer context failed");
        let mut surface = softbuffer::Surface::new(&context, Arc::clone(&window))
            .expect("softbuffer surface failed");
        let size = window.inner_size();
        if let (Some(nw), Some(nh)) = (NonZeroU32::new(size.width), NonZeroU32::new(size.height)) {
            let _ = surface.resize(nw, nh);
        }
        self.window = Some(window);
        self.surface = Some(surface);
        self.app.needs_redraw = true;
        self.request_redraw();
    }

    fn user_event(&mut self, _event_loop: &ActiveEventLoop, event: UserEvent) {
        match event {
            UserEvent::CoreWakeup => {
                if self.app.poll_snapshot() {
                    self.app.needs_redraw = true;
                    self.request_redraw();
                }
            }
        }
    }

    fn window_event(
        &mut self,
        event_loop: &ActiveEventLoop,
        _window_id: WindowId,
        event: WindowEvent,
    ) {
        match event {
            WindowEvent::CloseRequested => {
                event_loop.exit();
            }
            WindowEvent::Resized(size) => {
                if let Some(surface) = self.surface.as_mut() {
                    if let (Some(nw), Some(nh)) =
                        (NonZeroU32::new(size.width), NonZeroU32::new(size.height))
                    {
                        let _ = surface.resize(nw, nh);
                    }
                }
                self.app.needs_redraw = true;
                self.request_redraw();
            }
            WindowEvent::ModifiersChanged(mods) => {
                self.modifiers = mods.state();
            }
            WindowEvent::CursorMoved { position, .. } => {
                self.app
                    .handle_pointer_moved(Pos2f::new(position.x as f32, position.y as f32));
                if self.app.needs_redraw {
                    self.request_redraw();
                }
            }
            WindowEvent::MouseInput { state, button, .. } => {
                let pos = self.app.pointer_pos;
                match (button, state) {
                    (MouseButton::Left, ElementState::Pressed) => {
                        self.app.handle_primary_down(pos);
                    }
                    (MouseButton::Left, ElementState::Released) => {
                        self.app.handle_primary_up();
                    }
                    (MouseButton::Right, ElementState::Pressed) => {
                        self.app.handle_secondary_down(pos);
                    }
                    (MouseButton::Right, ElementState::Released) => {
                        self.app.handle_secondary_up(pos);
                    }
                    _ => {}
                }
                if self.app.needs_redraw {
                    self.request_redraw();
                }
            }
            WindowEvent::MouseWheel { delta, .. } => {
                let dy = match delta {
                    MouseScrollDelta::LineDelta(_, y) => y * 28.0,
                    MouseScrollDelta::PixelDelta(p) => p.y as f32,
                };
                self.app.handle_scroll(dy);
                if self.app.needs_redraw {
                    self.request_redraw();
                }
            }
            WindowEvent::KeyboardInput {
                event,
                is_synthetic: false,
                ..
            } if event.state == ElementState::Pressed => {
                self.handle_key_pressed(&event, event_loop);
                if self.app.needs_redraw {
                    self.request_redraw();
                }
            }
            WindowEvent::RedrawRequested => {
                self.app.poll_snapshot();
                let animating = self.app.step_camera_flight(Instant::now());
                if animating {
                    self.app.needs_redraw = true;
                }
                self.render_surface();
            }
            _ => {}
        }
    }

    fn about_to_wait(&mut self, event_loop: &ActiveEventLoop) {
        if self.app.poll_snapshot() {
            self.app.needs_redraw = true;
        }
        let animating = self.app.step_camera_flight(Instant::now());
        if animating || self.app.needs_redraw {
            self.request_redraw();
        }
        if animating {
            event_loop.set_control_flow(ControlFlow::WaitUntil(
                Instant::now() + Duration::from_millis(8),
            ));
        } else {
            event_loop.set_control_flow(ControlFlow::Wait);
        }
    }
}

fn run_headless_smoke_test() {
    let mut app = CaelusApp::new_with_wakeup(None);
    assert!(!app.lens.shows_worksheet());

    app.apply_radial_sector(RadialSector::SouthDealLens);
    assert_eq!(app.lens, FaaLens::DealFeasibility02);

    app.apply_radial_sector(RadialSector::WestTogglePierB);
    wait_until_pier_b(&mut app);
    assert!(app.backup_pier_b);
    assert!(app.hub_eval().delay_minutes < 10);

    let ring_len = caelus_core::domain::great_circle_arc(
        caelus_core::domain::AEGEAN_PORTS[0].lat_deg,
        caelus_core::domain::AEGEAN_PORTS[0].lon_deg,
        caelus_core::domain::AEGEAN_PORTS[1].lat_deg,
        caelus_core::domain::AEGEAN_PORTS[1].lon_deg,
        10,
    )
    .len();
    assert!(ring_len >= 2);

    app.apply_leap_query("GRSMI", true);
    assert!((app.yaw_deg - 26.978).abs() < 0.01);

    app.apply_leap_query("!AIVDM,1,1,,B,177KQJ5000G?tO`K>RA1wUbN0TKH,0*5C", true);
    assert!(app.ingested_fix.is_some());

    let dmg = app.render_to_buffers(1280, 800, None);
    assert!(!dmg.is_empty());

    println!(
        "CAELUS_SMOKE_TEST_PASS yaw={:.3} ring_pts={} delay={} gen={} ai_action={:?}",
        app.yaw_deg,
        ring_len,
        app.hub_eval().delay_minutes,
        app.snapshot.generation,
        app.snapshot.ai_action
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn smoke_test_pipeline_and_projection_work() {
        run_headless_smoke_test();
    }

    #[test]
    fn radial_sectors_cover_all_eight_actions() {
        let mut app = CaelusApp::new_with_wakeup(None);
        let p = app.project(38.196, 26.836, Pos2f::new(400.0, 400.0), 300.0);
        assert!(p.is_some());
        let back = app.project(-38.0, -153.0, Pos2f::new(400.0, 400.0), 300.0);
        assert!(back.is_none());

        app.apply_radial_sector(RadialSector::NorthEastAirAdsb);
        assert_eq!(app.domain, DomainMode::AirAdsb);

        app.apply_radial_sector(RadialSector::EastSpaceTle);
        assert_eq!(app.domain, DomainMode::SpaceTle);

        app.apply_radial_sector(RadialSector::SouthEastCrisis);
        assert_eq!(app.domain, DomainMode::CrisisBorder);

        app.apply_radial_sector(RadialSector::NorthMaritimeAis);
        assert_eq!(app.domain, DomainMode::MaritimeAis);

        app.apply_radial_sector(RadialSector::SouthWestHubLens);
        assert_eq!(app.lens, FaaLens::PortHub03);

        app.apply_radial_sector(RadialSector::NorthWestToggleTheme);
        assert_eq!(app.theme, crate::theme::ThemeMode::OpenBridgeNight);
    }

    #[test]
    fn dirty_rect_base_cache_hit_skips_globe_rerender() {
        let mut app = CaelusApp::new_with_wakeup(None);
        let mut pixels = vec![0u32; 1280 * 800];
        let dmg_cold = app.render_to_buffers(1280, 800, Some(&mut pixels));
        assert!(!app.last_base_cache_hit);
        assert_eq!(dmg_cold, vec![DirtyRect::full(1280, 800)]);

        app.domain = DomainMode::AirAdsb;
        app.needs_redraw = true;
        let dmg_warm = app.render_to_buffers(1280, 800, Some(&mut pixels));
        assert!(app.last_base_cache_hit);
        assert!(!dmg_warm.is_empty());
        assert!(app.last_damage_pixels < (1280 * 800));
    }
}
