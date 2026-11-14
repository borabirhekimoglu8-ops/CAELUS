//! Warm Swiss Cartography (Day) and OpenBridge (Night) color palettes
//! plus lightweight zero-allocation geometry primitives for tiny-skia/softbuffer.

use tiny_skia::Color;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ThemeMode {
    SwissDay,
    OpenBridgeNight,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct RgbaColor {
    pub r: u8,
    pub g: u8,
    pub b: u8,
    pub a: u8,
}

impl RgbaColor {
    #[inline]
    pub const fn from_rgb(r: u8, g: u8, b: u8) -> Self {
        Self { r, g, b, a: 255 }
    }

    #[inline]
    pub const fn from_rgba(r: u8, g: u8, b: u8, a: u8) -> Self {
        Self { r, g, b, a }
    }

    #[inline]
    pub fn with_alpha(self, a: u8) -> Self {
        Self { a, ..self }
    }

    #[inline]
    pub fn to_skia(self) -> Color {
        Color::from_rgba8(self.r, self.g, self.b, self.a)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct Vec2f {
    pub x: f32,
    pub y: f32,
}

impl Vec2f {
    #[inline]
    pub const fn new(x: f32, y: f32) -> Self {
        Self { x, y }
    }

    #[inline]
    pub fn length(self) -> f32 {
        (self.x * self.x + self.y * self.y).sqrt()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct Pos2f {
    pub x: f32,
    pub y: f32,
}

impl Pos2f {
    pub const ZERO: Self = Self { x: 0.0, y: 0.0 };

    #[inline]
    pub const fn new(x: f32, y: f32) -> Self {
        Self { x, y }
    }
}

impl std::ops::Add<Vec2f> for Pos2f {
    type Output = Pos2f;
    #[inline]
    fn add(self, rhs: Vec2f) -> Self::Output {
        Pos2f::new(self.x + rhs.x, self.y + rhs.y)
    }
}

impl std::ops::Sub<Pos2f> for Pos2f {
    type Output = Vec2f;
    #[inline]
    fn sub(self, rhs: Pos2f) -> Self::Output {
        Vec2f::new(self.x - rhs.x, self.y - rhs.y)
    }
}

impl std::ops::Mul<f32> for Vec2f {
    type Output = Vec2f;
    #[inline]
    fn mul(self, rhs: f32) -> Self::Output {
        Vec2f::new(self.x * rhs, self.y * rhs)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct RectF {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
}

impl RectF {
    #[inline]
    pub const fn from_xywh(x: f32, y: f32, w: f32, h: f32) -> Self {
        Self { x, y, w, h }
    }

    #[inline]
    pub fn from_center_size(center: Pos2f, w: f32, h: f32) -> Self {
        Self {
            x: center.x - w * 0.5,
            y: center.y - h * 0.5,
            w,
            h,
        }
    }

    #[inline]
    pub fn contains(self, p: Pos2f) -> bool {
        p.x >= self.x && p.x <= self.x + self.w && p.y >= self.y && p.y <= self.y + self.h
    }

    #[inline]
    pub fn center(self) -> Pos2f {
        Pos2f::new(self.x + self.w * 0.5, self.y + self.h * 0.5)
    }

    #[inline]
    pub fn expand(self, margin: f32) -> Self {
        Self {
            x: self.x - margin,
            y: self.y - margin,
            w: (self.w + margin * 2.0).max(0.0),
            h: (self.h + margin * 2.0).max(0.0),
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct Palette {
    pub canvas_bg: RgbaColor,
    pub panel_bg: RgbaColor,
    pub panel_border: RgbaColor,
    pub globe_sea: RgbaColor,
    pub globe_land: RgbaColor,
    pub globe_coast: RgbaColor,
    pub globe_grid: RgbaColor,
    pub globe_night_tint: RgbaColor,
    pub brass_accent: RgbaColor,
    pub ink_primary: RgbaColor,
    pub ink_muted: RgbaColor,
    pub badge_bg: RgbaColor,
    pub badge_text: RgbaColor,
    pub alert_rust: RgbaColor,
    pub safe_pine: RgbaColor,
}

pub const SWISS_DAY: Palette = Palette {
    canvas_bg: RgbaColor::from_rgb(0xED, 0xE8, 0xDD),
    panel_bg: RgbaColor::from_rgb(0xE6, 0xDF, 0xD1),
    panel_border: RgbaColor::from_rgb(0xC9, 0xBF, 0xAE),
    globe_sea: RgbaColor::from_rgb(0x16, 0x32, 0x4F),
    globe_land: RgbaColor::from_rgb(0x21, 0x44, 0x66),
    globe_coast: RgbaColor::from_rgb(0xD8, 0xCF, 0xBE),
    globe_grid: RgbaColor::from_rgba(0xED, 0xE8, 0xDD, 42),
    globe_night_tint: RgbaColor::from_rgba(0x09, 0x15, 0x24, 92),
    brass_accent: RgbaColor::from_rgb(0xA1, 0x62, 0x07),
    ink_primary: RgbaColor::from_rgb(0x1C, 0x19, 0x17),
    ink_muted: RgbaColor::from_rgb(0x57, 0x53, 0x4E),
    badge_bg: RgbaColor::from_rgb(0x10, 0x25, 0x3B),
    badge_text: RgbaColor::from_rgb(0xF5, 0xF0, 0xE6),
    alert_rust: RgbaColor::from_rgb(0x9A, 0x34, 0x12),
    safe_pine: RgbaColor::from_rgb(0x1E, 0x56, 0x31),
};

pub const OPENBRIDGE_NIGHT: Palette = Palette {
    canvas_bg: RgbaColor::from_rgb(0x17, 0x1A, 0x1F),
    panel_bg: RgbaColor::from_rgb(0x1D, 0x21, 0x28),
    panel_border: RgbaColor::from_rgb(0x32, 0x39, 0x44),
    globe_sea: RgbaColor::from_rgb(0x10, 0x24, 0x39),
    globe_land: RgbaColor::from_rgb(0x1B, 0x34, 0x4E),
    globe_coast: RgbaColor::from_rgb(0x94, 0xA3, 0xB8),
    globe_grid: RgbaColor::from_rgba(0xCB, 0xD5, 0xE1, 36),
    globe_night_tint: RgbaColor::from_rgba(0x06, 0x0D, 0x16, 118),
    brass_accent: RgbaColor::from_rgb(0xD9, 0x77, 0x06),
    ink_primary: RgbaColor::from_rgb(0xED, 0xE8, 0xDD),
    ink_muted: RgbaColor::from_rgb(0xA8, 0xA2, 0x9E),
    badge_bg: RgbaColor::from_rgb(0x0E, 0x17, 0x26),
    badge_text: RgbaColor::from_rgb(0xF8, 0xFA, 0xFC),
    alert_rust: RgbaColor::from_rgb(0xEA, 0x58, 0x0C),
    safe_pine: RgbaColor::from_rgb(0x22, 0xC5, 0x5E),
};

impl ThemeMode {
    /// Returns the active color palette.
    pub fn palette(self) -> Palette {
        match self {
            Self::SwissDay => SWISS_DAY,
            Self::OpenBridgeNight => OPENBRIDGE_NIGHT,
        }
    }

    /// Toggles between Warm Swiss Day and OpenBridge Night.
    pub fn toggled(self) -> Self {
        match self {
            Self::SwissDay => Self::OpenBridgeNight,
            Self::OpenBridgeNight => Self::SwissDay,
        }
    }
}
