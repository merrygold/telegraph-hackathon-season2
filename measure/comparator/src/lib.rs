//! Tripwire Measure: Telegraph's reference comparison rule for deterministic intents.
//! No imports, no state that affects a score, same output for the same input.
#![no_std]

use core::sync::atomic::{AtomicU32, Ordering};

#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    loop {}
}

// The node asks for 16 bytes per comparison spec. Hand out fixed 16-byte slots and take them back on free.
const SLOTS: usize = 32;
static mut POOL: [[u8; 16]; SLOTS] = [[0; 16]; SLOTS];
static USED: AtomicU32 = AtomicU32::new(0);

#[no_mangle]
pub extern "C" fn imw_alloc(size: i32) -> i32 {
    if size < 0 || size > 16 {
        return 0;
    }
    let used = USED.load(Ordering::Relaxed);
    let slot = (!used).trailing_zeros() as usize;
    if slot >= SLOTS {
        return 0;
    }
    USED.store(used | (1 << slot), Ordering::Relaxed);
    unsafe { core::ptr::addr_of_mut!(POOL[slot]) as i32 }
}

#[no_mangle]
pub extern "C" fn imw_free(ptr: i32, _size: i32) {
    let base = core::ptr::addr_of!(POOL) as i32;
    let off = ptr.wrapping_sub(base);
    if off >= 0 && off % 16 == 0 && (off / 16) < SLOTS as i32 {
        USED.fetch_and(!(1 << (off / 16)), Ordering::Relaxed);
    }
}

/// Score in basis points, 0 to 10000. `spec_ptr` points to two little-endian i64: code, tolerance.
#[no_mangle]
pub extern "C" fn imw_score_deterministic(truth: i64, miner: i64, spec_ptr: i32) -> i64 {
    let spec = unsafe { core::ptr::read_unaligned(spec_ptr as usize as *const [u8; 16]) };
    let mut w = [0u8; 8];
    w.copy_from_slice(&spec[..8]);
    let code = i64::from_le_bytes(w) as i32; // the code is read as a 32-bit integer
    w.copy_from_slice(&spec[8..]);
    score(truth, miner, code, i64::from_le_bytes(w))
}

fn score(truth: i64, miner: i64, code: i32, tol: i64) -> i64 {
    let exact = if miner == truth { 10_000 } else { 0 };
    // 128-bit throughout: at wei scale (1e18) difference x 10000 overflows 64 bits.
    let diff = (miner as i128 - truth as i128).unsigned_abs();
    let err = match code {
        1 => diff,                                                               // AbsTol
        2 => diff * 10_000 / core::cmp::max((truth as i128).unsigned_abs(), 1), // RelTol, in bps
        _ => return exact,                                                       // Exact, PassFail, unknown
    };
    if tol <= 0 {
        return exact; // "a tolerance of 0 or less means only an exact match scores"
    }
    let window = 2 * tol as u128;
    if err >= window {
        return 0;
    }
    (10_000 * (window - err) / window) as i64
}
