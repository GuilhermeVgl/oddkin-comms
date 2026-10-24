package calls

import (
	"context"
	"slices"
	"sync"
)

// FakeRooms is an in-memory Rooms for tests; Join and Leave simulate clients
// connecting with a token.
type FakeRooms struct {
	mu      sync.Mutex
	Rooms   map[string]uint32
	members map[string][]string
	Removed []string
}

// NewFakeRooms returns an empty fake.
func NewFakeRooms() *FakeRooms {
	return &FakeRooms{Rooms: map[string]uint32{}, members: map[string][]string{}}
}

func (f *FakeRooms) CreateRoom(_ context.Context, name string, maxParticipants uint32) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.Rooms[name] = maxParticipants
	return nil
}

func (f *FakeRooms) DeleteRoom(_ context.Context, name string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.Rooms, name)
	delete(f.members, name)
	return nil
}

func (f *FakeRooms) Participants(_ context.Context, name string) ([]string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return slices.Clone(f.members[name]), nil
}

func (f *FakeRooms) Remove(_ context.Context, name, identity string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.members[name] = slices.DeleteFunc(f.members[name], func(id string) bool { return id == identity })
	f.Removed = append(f.Removed, identity)
	return nil
}

// Join adds an identity to a room as a connected client would.
func (f *FakeRooms) Join(name, identity string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if !slices.Contains(f.members[name], identity) {
		f.members[name] = append(f.members[name], identity)
	}
}
