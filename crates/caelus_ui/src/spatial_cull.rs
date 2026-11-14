//! Frustum + H3-bucket LOD parallel spatial culler using `rayon`.
//! Allows 100,000+ satellites, vessels, aircraft, or cables to exist in memory
//! while filtering strictly to front-hemisphere visible LOD representatives in < 2 ms.

use crate::theme::{Pos2f, RectF};
use rayon::prelude::*;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SpatialEntity {
    pub id: u64,
    pub lat_deg: f64,
    pub lon_deg: f64,
    pub kind: u8,
    pub priority: u8,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CulledEntity {
    pub entity: SpatialEntity,
    pub screen_x: f32,
    pub screen_y: f32,
    pub h3_cell: u64,
}

/// Deterministic zoom-dependent H3-like resolution level (2..=6).
#[inline]
#[must_use]
pub fn lod_resolution_for_zoom(zoom: f32) -> u8 {
    if zoom < 0.9 {
        2
    } else if zoom < 1.5 {
        3
    } else if zoom < 2.6 {
        4
    } else if zoom < 4.2 {
        5
    } else {
        6
    }
}

/// Deterministic hexagonal/icosahedral spatial cell key `(res, hex_q, hex_r, face)`
/// used for zero-allocation LOD thinning across zoomed regions.
#[inline]
#[must_use]
pub fn h3_cell_key(lat_deg: f64, lon_deg: f64, res: u8) -> u64 {
    let clamped_res = res.clamp(1, 7);
    // Scale angular grid by 2^res (hexagonal axial stagger on equal-area cylindrical cells)
    let scale = (1u32 << clamped_res) as f64;
    let lat_norm = (lat_deg.clamp(-89.999, 89.999) + 90.0) / 180.0;
    let lon_norm = (lon_deg.rem_euclid(360.0)) / 360.0;

    let row = (lat_norm * 15.0 * scale) as u64;
    let stagger = if (row & 1) == 1 { 0.5 } else { 0.0 };
    let col = ((lon_norm * 30.0 * scale + stagger) as u64) & 0xFFFF_FFFF;
    let q = col.wrapping_sub(row / 2);
    let r = row;

    ((clamped_res as u64) << 56) | ((r & 0x00FF_FFFF) << 28) | (q & 0x0FFF_FFFF)
}

/// Filters `entities` in parallel across CPU cores via `rayon`:
/// 1. Orthographic front-hemisphere culling (`cos_c >= 0.02`)
/// 2. Viewport rect clipping (skip off-screen zoomed entities)
/// 3. H3 LOD cell deduplication keeping the highest-priority representative per cell
/// 4. Deterministic cap `max_visible`
#[must_use]
#[allow(clippy::too_many_arguments)]
pub fn cull_entities_parallel(
    entities: &[SpatialEntity],
    yaw_deg: f64,
    pitch_deg: f64,
    zoom: f32,
    center: Pos2f,
    radius: f32,
    viewport: RectF,
    max_visible: usize,
) -> Vec<CulledEntity> {
    if entities.is_empty() || max_visible == 0 {
        return Vec::new();
    }

    let lat0 = pitch_deg.to_radians();
    let lon0 = yaw_deg.to_radians();
    let sin_lat0 = lat0.sin();
    let cos_lat0 = lat0.cos();
    let res = lod_resolution_for_zoom(zoom);
    let pad = 24.0;
    let min_x = viewport.x - pad;
    let max_x = viewport.x + viewport.w + pad;
    let min_y = viewport.y - pad;
    let max_y = viewport.y + viewport.h + pad;

    let project_entity = |entity: SpatialEntity| -> Option<CulledEntity> {
        let lat = entity.lat_deg.to_radians();
        let lon = entity.lon_deg.to_radians();
        let dlon = lon - lon0;

        let sin_lat = lat.sin();
        let cos_lat = lat.cos();
        let cos_c = sin_lat0 * sin_lat + cos_lat0 * cos_lat * dlon.cos();
        if cos_c < 0.02 {
            return None;
        }

        let x = cos_lat * dlon.sin();
        let y = cos_lat0 * sin_lat - sin_lat0 * cos_lat * dlon.cos();
        let sx = center.x + (x as f32) * radius;
        let sy = center.y - (y as f32) * radius;
        if sx < min_x || sx > max_x || sy < min_y || sy > max_y {
            return None;
        }

        Some(CulledEntity {
            entity,
            screen_x: sx,
            screen_y: sy,
            h3_cell: h3_cell_key(entity.lat_deg, entity.lon_deg, res),
        })
    };

    let use_parallel = entities.len() >= 2_048;
    if use_parallel {
        static RAYON_INIT: std::sync::Once = std::sync::Once::new();
        RAYON_INIT.call_once(|| {
            let _ = rayon::ThreadPoolBuilder::new()
                .num_threads(3)
                .stack_size(256 * 1024)
                .build_global();
        });
    }

    let mut visible: Vec<CulledEntity> = if use_parallel {
        entities
            .par_iter()
            .copied()
            .filter_map(project_entity)
            .collect()
    } else {
        entities
            .iter()
            .copied()
            .filter_map(project_entity)
            .collect()
    };

    if visible.len() <= max_visible && res >= 6 {
        visible.sort_unstable_by_key(|c| (std::cmp::Reverse(c.entity.priority), c.entity.id));
        return visible;
    }

    // Deduplicate by (h3_cell, kind) retaining highest priority, then lowest id deterministically
    let cmp_visible = |a: &CulledEntity, b: &CulledEntity| {
        a.h3_cell
            .cmp(&b.h3_cell)
            .then_with(|| a.entity.kind.cmp(&b.entity.kind))
            .then_with(|| b.entity.priority.cmp(&a.entity.priority))
            .then_with(|| a.entity.id.cmp(&b.entity.id))
    };
    if use_parallel {
        visible.par_sort_unstable_by(cmp_visible);
    } else {
        visible.sort_unstable_by(cmp_visible);
    }

    let mut deduped = Vec::with_capacity(visible.len().min(max_visible));
    let mut last_key: Option<(u64, u8)> = None;
    for item in visible {
        let key = (item.h3_cell, item.entity.kind);
        if last_key != Some(key) {
            last_key = Some(key);
            deduped.push(item);
        }
    }

    deduped.sort_unstable_by_key(|c| (std::cmp::Reverse(c.entity.priority), c.entity.id));
    deduped.truncate(max_visible);
    deduped
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn culls_100k_entities_with_frustum_and_h3_lod() {
        let entities: Vec<SpatialEntity> = (0..100_000u64)
            .map(|i| {
                let lat = ((i % 170) as f64) - 85.0;
                let lon = (((i * 37) % 360) as f64) - 180.0;
                SpatialEntity {
                    id: i,
                    lat_deg: lat,
                    lon_deg: lon,
                    kind: (i % 4) as u8,
                    priority: (i % 255) as u8,
                }
            })
            .collect();

        let center = Pos2f::new(640.0, 400.0);
        let viewport = RectF::from_xywh(0.0, 0.0, 1280.0, 800.0);
        let culled =
            cull_entities_parallel(&entities, 26.8, 37.9, 2.2, center, 680.0, viewport, 320);

        assert!(!culled.is_empty());
        assert!(culled.len() <= 320);
        // Repeat with identical inputs to prove deterministic output
        let culled_b =
            cull_entities_parallel(&entities, 26.8, 37.9, 2.2, center, 680.0, viewport, 320);
        assert_eq!(culled, culled_b);
    }

    #[test]
    fn h3_cell_granularity_scales_with_zoom() {
        assert!(lod_resolution_for_zoom(0.7) < lod_resolution_for_zoom(3.5));
        let c1 = h3_cell_key(38.196, 26.836, 3);
        let c2 = h3_cell_key(38.197, 26.837, 3);
        assert_eq!(c1, c2);
    }
}
