//! 16 OpenBridge 6.1 vector transport symbols (rasterized once via `usvg` + `resvg`
//! with `default-features = false` so `fontdb` is never compiled or mmapped) plus the
//! official CAELUS OS 3-Crescent vector emblem rendered via `tiny-skia` cubic Beziers.

use crate::theme::{Palette, RgbaColor};
use tiny_skia::{FillRule, Paint, PathBuilder, Pixmap, PixmapMut, Stroke, Transform};

const SPRITE_SVG: &str = include_str!("../../../design-canon/symbols/caelus_symbols_sprite.svg");

pub const SYMBOL_SIZE_PX: u32 = 18;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum SymbolId {
    Sym01LeoSatellite = 0,
    Sym02LaunchVehicle = 1,
    Sym03AirlinerAdsb = 2,
    Sym04RotorcraftSar = 3,
    Sym05VesselContainer = 4,
    Sym06VesselFerry = 5,
    Sym07PortHubCrane = 6,
    Sym08ChokepointStrait = 7,
    Sym09RailCorridor = 8,
    Sym10TransitGtfs = 9,
    Sym11SubseaCable = 10,
    Sym12PowerGridHvdc = 11,
    Sym13HazardSeismic = 12,
    Sym14SpaceWeatherGnss = 13,
    Sym15DealMaLedger = 14,
    Sym16SentinelChronometer = 15,
}

impl SymbolId {
    pub const ALL: [Self; 16] = [
        Self::Sym01LeoSatellite,
        Self::Sym02LaunchVehicle,
        Self::Sym03AirlinerAdsb,
        Self::Sym04RotorcraftSar,
        Self::Sym05VesselContainer,
        Self::Sym06VesselFerry,
        Self::Sym07PortHubCrane,
        Self::Sym08ChokepointStrait,
        Self::Sym09RailCorridor,
        Self::Sym10TransitGtfs,
        Self::Sym11SubseaCable,
        Self::Sym12PowerGridHvdc,
        Self::Sym13HazardSeismic,
        Self::Sym14SpaceWeatherGnss,
        Self::Sym15DealMaLedger,
        Self::Sym16SentinelChronometer,
    ];

    pub const fn svg_id(self) -> &'static str {
        match self {
            Self::Sym01LeoSatellite => "sym-01-leo-satellite",
            Self::Sym02LaunchVehicle => "sym-02-launch-vehicle",
            Self::Sym03AirlinerAdsb => "sym-03-airliner-adsb",
            Self::Sym04RotorcraftSar => "sym-04-rotorcraft-sar",
            Self::Sym05VesselContainer => "sym-05-vessel-container",
            Self::Sym06VesselFerry => "sym-06-vessel-ferry",
            Self::Sym07PortHubCrane => "sym-07-port-hub-crane",
            Self::Sym08ChokepointStrait => "sym-08-chokepoint-strait",
            Self::Sym09RailCorridor => "sym-09-rail-corridor",
            Self::Sym10TransitGtfs => "sym-10-transit-gtfs",
            Self::Sym11SubseaCable => "sym-11-subsea-cable",
            Self::Sym12PowerGridHvdc => "sym-12-power-grid-hvdc",
            Self::Sym13HazardSeismic => "sym-13-hazard-seismic",
            Self::Sym14SpaceWeatherGnss => "sym-14-space-weather-gnss",
            Self::Sym15DealMaLedger => "sym-15-deal-ma-ledger",
            Self::Sym16SentinelChronometer => "sym-16-sentinel-chronometer",
        }
    }
}

/// Pre-rasterized 18x18 alpha templates for all 16 OpenBridge transport symbols (~21 KiB total).
pub struct SymbolAtlas {
    templates: [Pixmap; 16],
}

impl SymbolAtlas {
    /// Parses and rasterizes all 16 SVG symbols from the canonical sprite sheet once.
    pub fn build() -> Self {
        let mut templates: Vec<Pixmap> = Vec::with_capacity(16);
        let opts = usvg::Options::default();
        let scale = SYMBOL_SIZE_PX as f32 / 24.0;

        for sym in SymbolId::ALL {
            let svg_doc = extract_symbol_as_svg(SPRITE_SVG, sym.svg_id());
            let mut pixmap =
                Pixmap::new(SYMBOL_SIZE_PX, SYMBOL_SIZE_PX).expect("symbol pixmap size valid");
            if let Ok(tree) = usvg::Tree::from_str(&svg_doc, &opts) {
                resvg::render(
                    &tree,
                    Transform::from_scale(scale, scale),
                    &mut pixmap.as_mut(),
                );
            }
            templates.push(pixmap);
        }

        let arr: [Pixmap; 16] = templates
            .try_into()
            .unwrap_or_else(|_| panic!("expected 16 OpenBridge vector symbols"));
        Self { templates: arr }
    }

    /// Blits a pre-rasterized vector symbol centered at `(cx, cy)` with dynamic color tint.
    pub fn draw_tinted(
        &self,
        dst: &mut PixmapMut<'_>,
        sym: SymbolId,
        cx: f32,
        cy: f32,
        tint: RgbaColor,
    ) {
        let tpl = &self.templates[sym as usize];
        let sw = tpl.width() as i32;
        let sh = tpl.height() as i32;
        let dw = dst.width() as i32;
        let dh = dst.height() as i32;
        let ox = cx.round() as i32 - sw / 2;
        let oy = cy.round() as i32 - sh / 2;

        let src_data = tpl.data();
        let dst_data = dst.data_mut();

        for sy in 0..sh {
            let dy = oy + sy;
            if dy < 0 || dy >= dh {
                continue;
            }
            for sx in 0..sw {
                let dx = ox + sx;
                if dx < 0 || dx >= dw {
                    continue;
                }
                let s_idx = ((sy * sw + sx) as usize) * 4;
                let mask_a = src_data[s_idx + 3] as u32;
                if mask_a == 0 {
                    continue;
                }
                let eff_a = (mask_a * tint.a as u32) / 255;
                if eff_a == 0 {
                    continue;
                }
                let inv_a = 255 - eff_a;
                let d_idx = ((dy * dw + dx) as usize) * 4;
                dst_data[d_idx] =
                    ((tint.r as u32 * eff_a + dst_data[d_idx] as u32 * inv_a) / 255) as u8;
                dst_data[d_idx + 1] =
                    ((tint.g as u32 * eff_a + dst_data[d_idx + 1] as u32 * inv_a) / 255) as u8;
                dst_data[d_idx + 2] =
                    ((tint.b as u32 * eff_a + dst_data[d_idx + 2] as u32 * inv_a) / 255) as u8;
                dst_data[d_idx + 3] = 255;
            }
        }
    }

    #[cfg(test)]
    pub fn template_alpha_sum(&self, sym: SymbolId) -> u64 {
        self.templates[sym as usize]
            .data()
            .chunks_exact(4)
            .map(|px| px[3] as u64)
            .sum()
    }
}

fn extract_symbol_as_svg(sprite: &str, id: &str) -> String {
    let needle = format!("<symbol id=\"{id}\"");
    let Some(start) = sprite.find(&needle) else {
        return "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\"/>"
            .to_string();
    };
    let tail = &sprite[start..];
    let Some(end_rel) = tail.find("</symbol>") else {
        return "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\"/>"
            .to_string();
    };
    let block = &tail[..end_rel + "</symbol>".len()];
    block
        .replacen(
            "<symbol ",
            "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" ",
            1,
        )
        .replace("</symbol>", "</svg>")
        .replace("currentColor", "#FFFFFF")
}

/// Renders the official CAELUS OS 3-Crescent vector emblem (`CAELUS_OFFICIAL_3CRESCENT_V75`)
/// centered at `(cx, cy)` with pixel diameter `size` using exact `tiny-skia` cubic Beziers.
pub fn draw_caelus_emblem(pixmap: &mut PixmapMut<'_>, cx: f32, cy: f32, size: f32, pal: &Palette) {
    let scale = size / 256.0;
    let xform = Transform::from_translate(cx - size * 0.5, cy - size * 0.5).pre_scale(scale, scale);

    // Outer boundary ring (cx=128, cy=128, r=118)
    if let Some(ring_path) = PathBuilder::from_circle(128.0, 128.0, 118.0) {
        let mut paint = Paint {
            anti_alias: true,
            ..Paint::default()
        };
        paint.set_color(pal.brass_accent.with_alpha(150).to_skia());
        let stroke = Stroke {
            width: 6.0,
            ..Stroke::default()
        };
        pixmap.stroke_path(&ring_path, &paint, &stroke, xform, None);
    }

    // Crescent 1: outer_crescent
    let mut pb1 = PathBuilder::new();
    pb1.move_to(196.0, 66.0);
    pb1.cubic_to(166.0, 26.0, 106.0, 18.0, 66.0, 52.0);
    pb1.cubic_to(26.0, 86.0, 24.0, 148.0, 60.0, 188.0);
    pb1.cubic_to(84.0, 214.0, 122.0, 226.0, 158.0, 218.0);
    pb1.cubic_to(112.0, 216.0, 74.0, 186.0, 64.0, 144.0);
    pb1.cubic_to(52.0, 94.0, 86.0, 48.0, 136.0, 44.0);
    pb1.cubic_to(160.0, 42.0, 180.0, 52.0, 196.0, 66.0);
    pb1.close();
    if let Some(path) = pb1.finish() {
        let mut paint = Paint {
            anti_alias: true,
            ..Paint::default()
        };
        paint.set_color(pal.globe_sea.to_skia());
        pixmap.fill_path(&path, &paint, FillRule::Winding, xform, None);
    }

    // Crescent 2: mid_crescent
    let mut pb2 = PathBuilder::new();
    pb2.move_to(174.0, 184.0);
    pb2.cubic_to(198.0, 158.0, 198.0, 116.0, 172.0, 90.0);
    pb2.cubic_to(146.0, 64.0, 104.0, 66.0, 80.0, 94.0);
    pb2.cubic_to(64.0, 114.0, 60.0, 142.0, 70.0, 166.0);
    pb2.cubic_to(68.0, 138.0, 80.0, 110.0, 104.0, 98.0);
    pb2.cubic_to(132.0, 84.0, 166.0, 98.0, 176.0, 128.0);
    pb2.cubic_to(182.0, 148.0, 180.0, 168.0, 174.0, 184.0);
    pb2.close();
    if let Some(path) = pb2.finish() {
        let mut paint = Paint {
            anti_alias: true,
            ..Paint::default()
        };
        paint.set_color(pal.brass_accent.to_skia());
        pixmap.fill_path(&path, &paint, FillRule::Winding, xform, None);
    }

    // Crescent 3: inner_crescent
    let mut pb3 = PathBuilder::new();
    pb3.move_to(104.0, 162.0);
    pb3.cubic_to(92.0, 146.0, 94.0, 122.0, 110.0, 110.0);
    pb3.cubic_to(126.0, 98.0, 150.0, 102.0, 160.0, 120.0);
    pb3.cubic_to(148.0, 112.0, 130.0, 112.0, 118.0, 122.0);
    pb3.cubic_to(106.0, 132.0, 104.0, 148.0, 104.0, 162.0);
    pb3.close();
    if let Some(path) = pb3.finish() {
        let mut paint = Paint {
            anti_alias: true,
            ..Paint::default()
        };
        paint.set_color(pal.ink_primary.to_skia());
        pixmap.fill_path(&path, &paint, FillRule::Winding, xform, None);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::theme::SWISS_DAY;

    #[test]
    fn builds_all_16_openbridge_vector_symbols_and_emblem() {
        let atlas = SymbolAtlas::build();
        for sym in SymbolId::ALL {
            let alpha_sum = atlas.template_alpha_sum(sym);
            assert!(alpha_sum > 200, "symbol {:?} rendered empty", sym);
        }

        let mut pixmap = Pixmap::new(64, 64).unwrap();
        draw_caelus_emblem(&mut pixmap.as_mut(), 32.0, 32.0, 48.0, &SWISS_DAY);
        let non_zero = pixmap.data().iter().filter(|&&b| b != 0).count();
        assert!(
            non_zero > 500,
            "CAELUS emblem must render non-empty strokes/fills"
        );
    }
}
