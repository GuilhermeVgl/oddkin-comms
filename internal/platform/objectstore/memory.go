package objectstore

import (
	"context"
	"fmt"
	"sync"
	"time"
)

// Memory is an in-process Store for tests: parts are "uploaded" through Put.
type Memory struct {
	mu      sync.Mutex
	uploads map[string]map[int32]memPart // uploadID -> part
	keys    map[string]string            // uploadID -> key
	objects map[string]memObject
	counter int
}

type memPart struct {
	size int64
	data []byte // nil when a test only cares about the size
}

type memObject struct {
	size int64
	data []byte // nil when the parts carried no bytes
}

// NewMemory returns an empty in-memory store.
func NewMemory() *Memory {
	return &Memory{uploads: map[string]map[int32]memPart{}, keys: map[string]string{}, objects: map[string]memObject{}}
}

func (m *Memory) CreateMultipart(_ context.Context, key string) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.counter++
	id := fmt.Sprintf("upload-%d", m.counter)
	m.uploads[id] = map[int32]memPart{}
	m.keys[id] = key
	return id, nil
}

// PutPart simulates the browser PUT to a presigned part URL.
func (m *Memory) PutPart(uploadID string, part int32, size int64) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if parts, ok := m.uploads[uploadID]; ok {
		parts[part] = memPart{size: size}
	}
}

// PutPartData simulates the browser PUT of real bytes, so a test can read them back.
func (m *Memory) PutPartData(uploadID string, part int32, data []byte) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if parts, ok := m.uploads[uploadID]; ok {
		parts[part] = memPart{size: int64(len(data)), data: append([]byte(nil), data...)}
	}
}

func (m *Memory) PresignPart(_ context.Context, key, uploadID string, part int32, ttl time.Duration) (string, error) {
	return fmt.Sprintf("https://bucket.invalid/%s?uploadId=%s&partNumber=%d&ttl=%d", key, uploadID, part, int(ttl.Seconds())), nil
}

func (m *Memory) Complete(_ context.Context, key, uploadID string, parts []Part) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	stored, ok := m.uploads[uploadID]
	if !ok || m.keys[uploadID] != key {
		return ErrNotFound
	}
	var total int64
	var data []byte
	haveBytes := true
	for _, part := range parts {
		piece, present := stored[part.Number]
		if !present {
			return fmt.Errorf("part %d was never uploaded", part.Number)
		}
		total += piece.size
		if piece.data == nil {
			haveBytes = false
		} else if haveBytes {
			data = append(data, piece.data...)
		}
	}
	if !haveBytes {
		data = nil
	}
	m.objects[key] = memObject{size: total, data: data}
	delete(m.uploads, uploadID)
	delete(m.keys, uploadID)
	return nil
}

func (m *Memory) Abort(_ context.Context, _, uploadID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.uploads, uploadID)
	delete(m.keys, uploadID)
	return nil
}

func (m *Memory) Size(_ context.Context, key string) (int64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	object, ok := m.objects[key]
	if !ok {
		return 0, ErrNotFound
	}
	return object.size, nil
}

func (m *Memory) ReadRange(_ context.Context, key string, offset, length int64) ([]byte, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	object, ok := m.objects[key]
	if !ok {
		return nil, ErrNotFound
	}
	if offset >= int64(len(object.data)) {
		return []byte{}, nil
	}
	end := min(offset+length, int64(len(object.data)))
	return append([]byte(nil), object.data[offset:end]...), nil
}

func (m *Memory) PresignGet(_ context.Context, key string, ttl time.Duration) (string, error) {
	return fmt.Sprintf("https://bucket.invalid/%s?ttl=%d", key, int(ttl.Seconds())), nil
}

func (m *Memory) Delete(_ context.Context, key string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.objects, key)
	return nil
}

// Has reports whether an object exists, for assertions.
func (m *Memory) Has(key string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	_, ok := m.objects[key]
	return ok
}

// OpenUploads counts multipart uploads that were neither completed nor aborted.
func (m *Memory) OpenUploads() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.uploads)
}
