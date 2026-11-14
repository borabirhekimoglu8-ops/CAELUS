#![forbid(unsafe_code)]

//! CAELUS OS Zero-GPU Field & SSH Terminal Interface.
//!
//! Consumes asynchronous `CoreSnapshot` updates from `caelus_core` over `mpsc`
//! without opening any Vulkan/DX12/OpenGL context (0.0% GPU pressure).

use caelus_core::active_inference::MaritimeAction;
use caelus_core::domain::{find_port_by_query, CorridorKind, FaaLens, Locale, AEGEAN_PORTS};
use caelus_core::worker::{CoreParams, CoreSnapshot, HeadlessCoreHandle};
use crossterm::event::{self, Event, KeyCode, KeyEventKind};
use crossterm::terminal::{
    disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen,
};
use crossterm::ExecutableCommand;
use ratatui::backend::{CrosstermBackend, TestBackend};
use ratatui::layout::{Constraint, Direction, Layout};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, List, ListItem, Paragraph, Wrap};
use ratatui::{Frame, Terminal};
use std::io::{self, IsTerminal};
use std::time::Duration;

struct TuiApp {
    lens: FaaLens,
    locale: Locale,
    params: CoreParams,
    last_sent: CoreParams,
    snapshot: CoreSnapshot,
    handle: HeadlessCoreHandle,
    leap_mode: bool,
    leap_query: String,
    leap_status: String,
    should_quit: bool,
}

impl TuiApp {
    fn new() -> Self {
        let params = CoreParams::default();
        let initial = HeadlessCoreHandle::initial_snapshot(params);
        let handle = HeadlessCoreHandle::spawn(params, None);
        let snapshot = handle
            .recv_timeout(Duration::from_millis(250))
            .unwrap_or(initial);
        Self {
            lens: FaaLens::Globe01,
            locale: Locale::Tr,
            params,
            last_sent: params,
            snapshot,
            handle,
            leap_mode: false,
            leap_query: String::new(),
            leap_status: String::new(),
            should_quit: false,
        }
    }

    fn poll_snapshot(&mut self) {
        if let Some(snap) = self.handle.try_recv() {
            self.snapshot = snap;
        }
    }

    fn sync_params(&mut self) {
        if self.params != self.last_sent {
            self.last_sent = self.params;
            self.handle.submit_params(self.params);
        }
    }

    fn handle_key(&mut self, code: KeyCode) {
        if self.leap_mode {
            match code {
                KeyCode::Esc => {
                    self.leap_mode = false;
                }
                KeyCode::Enter => {
                    let q = self.leap_query.clone();
                    if let Some(port) = find_port_by_query(&q) {
                        self.leap_status = format!("{} ({})", port.name, port.unlocode);
                        self.params.corridor = if port.unlocode == "TRIZM" {
                            CorridorKind::IzmirSamos
                        } else {
                            CorridorKind::SeferihisarSamos
                        };
                        self.sync_params();
                    } else {
                        self.leap_status = if self.locale == Locale::Tr {
                            "Eslesme yok".to_string()
                        } else {
                            "No match".to_string()
                        };
                    }
                    self.leap_mode = false;
                }
                KeyCode::Backspace => {
                    self.leap_query.pop();
                }
                KeyCode::Char(c) => {
                    self.leap_query.push(c);
                }
                _ => {}
            }
            return;
        }

        match code {
            KeyCode::Char('q') | KeyCode::Esc => self.should_quit = true,
            KeyCode::Char('1') => self.lens = FaaLens::Globe01,
            KeyCode::Char('2') => self.lens = FaaLens::DealFeasibility02,
            KeyCode::Char('3') => self.lens = FaaLens::PortHub03,
            KeyCode::Char('4') => self.lens = FaaLens::SentinelCrisis04,
            KeyCode::Char('t') | KeyCode::Char('T') => {
                self.locale = if self.locale == Locale::Tr {
                    Locale::En
                } else {
                    Locale::Tr
                };
            }
            KeyCode::Char('b') | KeyCode::Char('B') => {
                self.params.backup_pier_b = !self.params.backup_pier_b;
                self.sync_params();
            }
            KeyCode::Char('x') | KeyCode::Char('X') => {
                self.params.storm_drill = !self.params.storm_drill;
                self.sync_params();
            }
            KeyCode::Char('c') | KeyCode::Char('C') => {
                self.params.corridor = match self.params.corridor {
                    CorridorKind::SeferihisarSamos => CorridorKind::IzmirSamos,
                    CorridorKind::IzmirSamos => CorridorKind::SeferihisarSamos,
                };
                self.sync_params();
            }
            KeyCode::Left => {
                self.params.time_hour = (self.params.time_hour - 1.0).max(-24.0);
                self.sync_params();
            }
            KeyCode::Right => {
                self.params.time_hour = (self.params.time_hour + 1.0).min(72.0);
                self.sync_params();
            }
            KeyCode::Char('/') => {
                self.leap_mode = true;
                self.leap_query.clear();
            }
            KeyCode::Char('r') => {
                self.handle.trigger_tick();
            }
            _ => {}
        }
    }

    fn render(&self, f: &mut Frame<'_>) {
        let root = Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Length(3),
                Constraint::Min(10),
                Constraint::Length(3),
            ])
            .split(f.area());

        let s = &self.snapshot;
        let tr = self.locale == Locale::Tr;

        let header_line = Line::from(vec![
            Span::styled(
                " CAELUS 0.9.1 FIELD TUI ",
                Style::default()
                    .fg(Color::Rgb(0xED, 0xE8, 0xDD))
                    .bg(Color::Rgb(0x16, 0x32, 0x4F))
                    .add_modifier(Modifier::BOLD),
            ),
            Span::raw(format!(
                " | {} | XTDB {} UTC {:02}:{:02} / GMT+3 {:02}:{:02} ({:+.0}h) | Pier B: {} | Storm: {} ",
                self.lens.label(self.locale),
                s.timeline.status_tag,
                s.timeline.utc_hour,
                s.timeline.utc_minute,
                s.timeline.local_hour,
                s.timeline.local_minute,
                s.timeline.offset_hours,
                if s.params.backup_pier_b { "ON" } else { "OFF" },
                if s.params.storm_drill { "ON" } else { "OFF" },
            )),
        ]);
        let header = Paragraph::new(header_line)
            .block(Block::default().borders(Borders::ALL).title("XTDB & Lens"));
        f.render_widget(header, root[0]);

        let body = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([Constraint::Percentage(46), Constraint::Percentage(54)])
            .split(root[1]);

        let mut port_items: Vec<ListItem<'_>> = AEGEAN_PORTS
            .iter()
            .take(5)
            .map(|p| {
                ListItem::new(format!(
                    "{} ({}) {:.3}N {:.3}E [{:.1}m]",
                    p.unlocode, p.name, p.lat_deg, p.lon_deg, p.depth_m
                ))
            })
            .collect();
        for v in s.vessels.iter().take(3) {
            port_items.push(ListItem::new(format!(
                "AIS {}: {:.1} kn | gap {}m",
                v.name, v.sog_kn, v.dark_gap_min
            )));
        }
        let left_panel =
            List::new(port_items).block(Block::default().borders(Borders::ALL).title(if tr {
                "Ege Koridoru & Filo"
            } else {
                "Aegean Corridor & Fleet"
            }));
        f.render_widget(left_panel, body[0]);

        let action_label = match s.ai_action {
            MaritimeAction::ProceedDirect => "ProceedDirect",
            MaritimeAction::DivertToShelterPort => "DivertToShelterPort",
            MaritimeAction::HoldAndVerifySensors => "HoldAndVerifySensors",
        };
        let mut detail_lines = vec![
            Line::from(format!(
                "{}: {:.2} - {:.2} EUR (max {:.2} EUR) | {} {}m",
                if tr { "Tarife Bandi" } else { "Fare Band" },
                s.feasibility.fare_min_eur,
                s.feasibility.fare_max_eur,
                s.feasibility.anti_gouging_ceiling_eur,
                if tr { "Geri Odeme" } else { "Payback" },
                s.feasibility.payback_months
            )),
            Line::from(format!(
                "{}: {} dk | UKC {} cm | GM {} cm | Dalga {} cm",
                if tr {
                    "Yanasim Gecikmesi"
                } else {
                    "Berthing Delay"
                },
                s.hub_eval.delay_minutes,
                s.hub_eval.ukc_margin_cm,
                s.hub_eval.baplie_gm_cm,
                s.hub_eval.wave_exposure_cm
            )),
            Line::from(format!(
                "CfC {:.3} | AI {} (EFE {:.3}) | P-bit {:.3}",
                s.cfc_anomaly, action_label, s.ai_efe, s.pbit_energy
            )),
            Line::from(format!(
                "Darwin {:.4} | HAL {:.4} mJ | E-Graph Equiv: {}",
                s.darwin_fitness, s.hal_net_mj, s.egraph_equivalent_route
            )),
            Line::from(format!(
                "V-JEPA {:.2} | CBF {:?} | Topos {:.0}kE | Calyx {:.2} | AIXI {} | RAIM:{} | {}",
                s.vjepa_surprise,
                s.cbf_safe_action,
                s.topos_welfare_keur,
                s.calyx_top_strength,
                s.aixitl_tag.code(),
                if s.raim_spoofed { "SPOOF" } else { "OK" },
                s.sentinel_code
            )),
            Line::from(format!(
                "Gen #{} | Ring Slots: {}/{}",
                s.generation, s.ring_len, s.ring_capacity
            )),
        ];
        if !self.leap_status.is_empty() {
            detail_lines.push(Line::from(format!("LEAP: {}", self.leap_status)));
        }
        let right_panel = Paragraph::new(detail_lines)
            .wrap(Wrap { trim: true })
            .block(
                Block::default()
                    .borders(Borders::ALL)
                    .title(self.lens.label(self.locale)),
            );
        f.render_widget(right_panel, body[1]);

        let footer_text = if self.leap_mode {
            format!("LEAP> {}_   [Enter: git | Esc: iptal]", self.leap_query)
        } else if tr {
            "[1-4] Lens | [Sol/Sag] XTDB | [b] Iskele B | [x] Firtina | [c] Koridor | [/] LEAP | [t] Dil | [q] Cikis".to_string()
        } else {
            "[1-4] Lens | [Left/Right] XTDB | [b] Pier B | [x] Storm | [c] Corridor | [/] LEAP | [t] Lang | [q] Quit".to_string()
        };
        let footer = Paragraph::new(footer_text).block(Block::default().borders(Borders::ALL));
        f.render_widget(footer, root[2]);
    }
}

fn render_once_snapshot_string() -> io::Result<String> {
    let mut app = TuiApp::new();
    app.poll_snapshot();
    let backend = TestBackend::new(100, 24);
    let mut terminal = Terminal::new(backend).unwrap_or_else(|e| match e {});
    let _ = terminal
        .draw(|f| app.render(f))
        .unwrap_or_else(|e| match e {});

    let buf = terminal.backend().buffer();
    let mut out = String::new();
    for y in 0..buf.area.height {
        let mut line = String::new();
        for x in 0..buf.area.width {
            line.push_str(buf[(x, y)].symbol());
        }
        out.push_str(line.trim_end());
        out.push('\n');
    }
    Ok(out)
}

fn run_interactive() -> io::Result<()> {
    let mut app = TuiApp::new();
    let mut stdout = io::stdout();
    enable_raw_mode()?;
    stdout.execute(EnterAlternateScreen)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    let res = (|| -> io::Result<()> {
        while !app.should_quit {
            app.poll_snapshot();
            terminal.draw(|f| app.render(f))?;
            if event::poll(Duration::from_millis(120))? {
                if let Event::Key(key) = event::read()? {
                    if key.kind == KeyEventKind::Press {
                        app.handle_key(key.code);
                    }
                }
            }
        }
        Ok(())
    })();

    disable_raw_mode()?;
    terminal.backend_mut().execute(LeaveAlternateScreen)?;
    terminal.show_cursor()?;
    res
}

fn main() -> io::Result<()> {
    if std::env::args().any(|a| a == "--once") || !io::stdout().is_terminal() {
        let rendered = render_once_snapshot_string()?;
        print!("{rendered}");
        return Ok(());
    }
    run_interactive()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_zero_gpu_tui_snapshot_and_handles_controls() {
        let frame_text = render_once_snapshot_string().expect("TUI TestBackend draw succeeds");
        assert!(frame_text.contains("CAELUS 0.9.1 FIELD TUI"));
        assert!(frame_text.contains("TRSEF"));

        let mut app = TuiApp::new();
        app.handle_key(KeyCode::Char('b'));
        app.handle_key(KeyCode::Right);
        for _ in 0..40 {
            if let Some(snap) = app.handle.recv_timeout(Duration::from_millis(200)) {
                app.snapshot = snap;
                if app.snapshot.params.backup_pier_b
                    && (app.snapshot.params.time_hour - 1.0).abs() < 1e-6
                {
                    break;
                }
            }
        }
        assert!(app.snapshot.params.backup_pier_b);
        assert!(app.snapshot.hub_eval.delay_minutes < 10);
    }
}
