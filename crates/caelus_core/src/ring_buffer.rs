//! Fixed-capacity zero-allocation circular ring buffer for continuous
//! maritime, air, space, and crisis telemetry history.

/// Fixed-capacity FIFO circular buffer backed by inline storage (`[Option<T>; N]`).
///
/// Overwrites the oldest slot in `O(1)` time without heap allocation or growth.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RingBuffer<T: Copy, const N: usize> {
    buf: [Option<T>; N],
    head: usize,
    len: usize,
}

impl<T: Copy, const N: usize> Default for RingBuffer<T, N> {
    fn default() -> Self {
        Self::new()
    }
}

impl<T: Copy, const N: usize> RingBuffer<T, N> {
    /// Creates an empty fixed-capacity [`RingBuffer`].
    #[must_use]
    pub const fn new() -> Self {
        Self {
            buf: [None; N],
            head: 0,
            len: 0,
        }
    }

    /// Returns the compile-time fixed slot capacity `N`.
    #[must_use]
    pub const fn capacity(&self) -> usize {
        N
    }

    /// Returns the number of populated items (`<= N`).
    #[must_use]
    pub const fn len(&self) -> usize {
        self.len
    }

    /// Returns `true` if no items are stored.
    #[must_use]
    pub const fn is_empty(&self) -> bool {
        self.len == 0
    }

    /// Returns `true` if `len == N` (or `N == 0`).
    #[must_use]
    pub const fn is_full(&self) -> bool {
        self.len == N
    }

    /// Clears all entries in `O(N)` without touching any heap allocator.
    pub fn clear(&mut self) {
        self.buf = [None; N];
        self.head = 0;
        self.len = 0;
    }

    /// Appends `item`, returning the evicted oldest element when full.
    ///
    /// For zero-capacity buffers (`N == 0`), returns `Some(item)` immediately.
    pub fn push(&mut self, item: T) -> Option<T> {
        if N == 0 {
            return Some(item);
        }
        let evicted = if self.len == N {
            self.buf[self.head].take()
        } else {
            None
        };
        self.buf[self.head] = Some(item);
        self.head = (self.head + 1) % N;
        if self.len < N {
            self.len += 1;
        }
        evicted
    }

    /// Returns the item at `logical_index` where `0` is oldest and `len - 1` is newest.
    #[must_use]
    pub fn get(&self, logical_index: usize) -> Option<&T> {
        if N == 0 || logical_index >= self.len {
            return None;
        }
        let oldest_idx = (self.head + N - self.len) % N;
        let slot = (oldest_idx + logical_index) % N;
        self.buf[slot].as_ref()
    }

    /// Returns the most recently pushed item.
    #[must_use]
    pub fn latest(&self) -> Option<&T> {
        if N == 0 || self.len == 0 {
            return None;
        }
        let newest_slot = (self.head + N - 1) % N;
        self.buf[newest_slot].as_ref()
    }

    /// Iterates over stored elements from oldest to newest.
    pub fn iter(&self) -> RingBufferIter<'_, T, N> {
        RingBufferIter { ring: self, pos: 0 }
    }
}

/// Immutable oldest-to-newest iterator over a [`RingBuffer`].
pub struct RingBufferIter<'a, T: Copy, const N: usize> {
    ring: &'a RingBuffer<T, N>,
    pos: usize,
}

impl<'a, T: Copy, const N: usize> Iterator for RingBufferIter<'a, T, N> {
    type Item = &'a T;

    fn next(&mut self) -> Option<Self::Item> {
        if self.pos >= self.ring.len {
            return None;
        }
        let item = self.ring.get(self.pos);
        self.pos += 1;
        item
    }

    fn size_hint(&self) -> (usize, Option<usize>) {
        let remaining = self.ring.len.saturating_sub(self.pos);
        (remaining, Some(remaining))
    }
}

impl<T: Copy, const N: usize> ExactSizeIterator for RingBufferIter<'_, T, N> {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn overwrites_oldest_slots_without_growth() {
        let mut ring: RingBuffer<u64, 4> = RingBuffer::new();
        assert!(ring.is_empty());
        assert_eq!(ring.capacity(), 4);
        assert_eq!(ring.latest(), None);

        for i in 1..=4 {
            assert_eq!(ring.push(i), None);
        }
        assert!(ring.is_full());
        assert_eq!(ring.len(), 4);
        assert_eq!(ring.latest(), Some(&4));

        assert_eq!(ring.push(5), Some(1));
        assert_eq!(ring.push(6), Some(2));
        assert_eq!(ring.len(), 4);
        let collected: Vec<u64> = ring.iter().copied().collect();
        assert_eq!(collected, vec![3, 4, 5, 6]);
        assert_eq!(ring.get(0), Some(&3));
        assert_eq!(ring.get(3), Some(&6));
        assert_eq!(ring.get(4), None);

        for k in 7..=10_000 {
            let _ = ring.push(k);
        }
        assert_eq!(ring.len(), 4);
        assert_eq!(ring.latest(), Some(&10_000));

        ring.clear();
        assert!(ring.is_empty());
        assert_eq!(ring.latest(), None);
    }

    #[test]
    fn zero_capacity_is_safe() {
        let mut ring: RingBuffer<u32, 0> = RingBuffer::new();
        assert!(ring.is_full());
        assert_eq!(ring.push(42), Some(42));
        assert_eq!(ring.get(0), None);
        assert_eq!(ring.latest(), None);
    }
}
