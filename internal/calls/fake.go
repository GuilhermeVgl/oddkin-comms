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
	// Screen records who may currently publish a screen, per room.
	Screen map[string]map[string]bool
}

// NewFakeRooms returns an empty fake.
func NewFakeRooms() *FakeRooms {
	return &FakeRooms{Rooms: map[string]uint32{}, members: map[string][]string{}, Screen: map[string]map[string]bool{}}
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

func (f *FakeRooms) SetScreenShare(_ context.Context, name, identity string, allowed bool) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.Screen[name] == nil {
		f.Screen[name] = map[string]bool{}
	}
	f.Screen[name][identity] = allowed
	return nil
}

// MayShareScreen reports whether the identity was last granted the screen.
func (f *FakeRooms) MayShareScreen(name, identity string) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.Screen[name][identity]
}
