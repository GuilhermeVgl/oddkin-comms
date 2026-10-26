package httpapi

import "testing"

func encryptedSize(original int64) int64 {
	return int64(fileHeaderLength) + original + fileRecordOverhead*((original+fileRecordSize-1)/fileRecordSize)
}

func TestPlaintextSizeInvertsTheEncryptedSize(t *testing.T) {
	for _, original := range []int64{1, 2, fileRecordSize - 1, fileRecordSize, fileRecordSize + 1, 3_000_000, MaxFileBytes - 1, MaxFileBytes, MaxFileBytes + 1} {
		got, ok := plaintextSizeFor(encryptedSize(original))
		if !ok || got != original {
			t.Fatalf("n=%d: got %d ok=%v", original, got, ok)
		}
	}
}

func TestSizesThatNoFileProducesAreRefused(t *testing.T) {
	// One byte more than the encrypted size of an exact multiple has no matching file size.
	full := encryptedSize(2 * fileRecordSize)
	for _, bad := range []int64{0, 1, int64(fileHeaderLength), int64(fileHeaderLength) + fileRecordOverhead, full + 1, encryptedSize(fileRecordSize) + 1} {
		if got, ok := plaintextSizeFor(bad); ok {
			t.Fatalf("size %d accepted as %d", bad, got)
		}
	}
}

func TestTheLimitIsFiveHundredMegabytesOfOriginalFile(t *testing.T) {
	atLimit, _ := plaintextSizeFor(encryptedSize(MaxFileBytes))
	over, _ := plaintextSizeFor(encryptedSize(MaxFileBytes + 1))
	if atLimit > MaxFileBytes || over <= MaxFileBytes {
		t.Fatalf("limit check: %d %d", atLimit, over)
	}
	if encryptedSize(MaxFileBytes) > MaxFileBytes+maxFileOverhead {
		t.Fatal("the physical ceiling must admit a full-size file")
	}
}
