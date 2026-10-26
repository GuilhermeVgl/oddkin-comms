// Package calls holds the LiveKit integration: join tokens, room administration
// and webhook verification. It contains no authorization policy.
package calls

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/livekit/protocol/auth"
	"github.com/livekit/protocol/livekit"
	"github.com/twitchtv/twirp"
)

// MaxParticipants is the admission limit, including the initiator.
const MaxParticipants = 5

// Config identifies the self-hosted LiveKit server.
type Config struct {
	// URL is the WebSocket address given to browsers.
	URL string
	// APIURL is the HTTP(S) address of the server API used for administration.
	APIURL    string
	APIKey    string
	APISecret string
}

func (c Config) valid() error {
	if c.URL == "" || c.APIURL == "" || c.APIKey == "" || c.APISecret == "" {
		return errors.New("LiveKit URL, API URL, key and secret are required")
	}
	return nil
}

// KeyProvider validates webhook signatures.
func (c Config) KeyProvider() auth.KeyProvider {
	return auth.NewSimpleKeyProvider(c.APIKey, c.APISecret)
}

// JoinToken mints a short token that can only join one room as one identity.
// Clients never get permission to create rooms, administer them, record or
// publish data; screen sharing is a separate, explicitly granted source.
func (c Config) JoinToken(room, identity, displayName string, screenShare bool, ttl time.Duration) (string, error) {
	if err := c.valid(); err != nil {
		return "", err
	}
	yes, no := true, false
	sources := []string{"microphone", "camera"}
	if screenShare {
		sources = append(sources, "screen_share", "screen_share_audio")
	}
	grant := &auth.VideoGrant{
		RoomJoin: true, Room: room, CanPublish: &yes, CanSubscribe: &yes, CanPublishData: &no,
		CanPublishSources: sources,
	}
	return auth.NewAccessToken(c.APIKey, c.APISecret).
		SetIdentity(identity).SetName(displayName).SetValidFor(ttl).SetVideoGrant(grant).ToJWT()
}

// Rooms is the administrative surface used by the backend.
type Rooms interface {
	CreateRoom(ctx context.Context, name string, maxParticipants uint32) error
	DeleteRoom(ctx context.Context, name string) error
	Participants(ctx context.Context, name string) ([]string, error)
	Remove(ctx context.Context, name, identity string) error
	// SetScreenShare lets one person publish their screen in the room, or
	// takes that back, without disconnecting them: reconnecting to change a
	// token would make the server see them leave (and end a call they were
	// alone in).
	SetScreenShare(ctx context.Context, name, identity string, allowed bool) error
}

type remoteRooms struct {
	config Config
	client livekit.RoomService
}

// NewRooms talks to LiveKit's Twirp RoomService with a per-request admin token.
func NewRooms(config Config) (Rooms, error) {
	if err := config.valid(); err != nil {
		return nil, err
	}
	return &remoteRooms{config: config, client: livekit.NewRoomServiceProtobufClient(config.APIURL, &http.Client{Timeout: 10 * time.Second})}, nil
}

func (r *remoteRooms) authorize(ctx context.Context, room string) (context.Context, error) {
	token, err := auth.NewAccessToken(r.config.APIKey, r.config.APISecret).SetValidFor(time.Minute).
		SetVideoGrant(&auth.VideoGrant{RoomCreate: true, RoomAdmin: true, RoomList: true, Room: room}).ToJWT()
	if err != nil {
		return ctx, err
	}
	header := http.Header{}
	header.Set("Authorization", "Bearer "+token)
	return twirp.WithHTTPRequestHeaders(ctx, header)
}

func (r *remoteRooms) CreateRoom(ctx context.Context, name string, maxParticipants uint32) error {
	ctx, err := r.authorize(ctx, name)
	if err != nil {
		return err
	}
	_, err = r.client.CreateRoom(ctx, &livekit.CreateRoomRequest{Name: name, MaxParticipants: maxParticipants, EmptyTimeout: 60, DepartureTimeout: 20})
	return err
}

func (r *remoteRooms) DeleteRoom(ctx context.Context, name string) error {
	ctx, err := r.authorize(ctx, name)
	if err != nil {
		return err
	}
	_, err = r.client.DeleteRoom(ctx, &livekit.DeleteRoomRequest{Room: name})
	return ignoreMissing(err)
}

func (r *remoteRooms) Participants(ctx context.Context, name string) ([]string, error) {
	ctx, err := r.authorize(ctx, name)
	if err != nil {
		return nil, err
	}
	response, err := r.client.ListParticipants(ctx, &livekit.ListParticipantsRequest{Room: name})
	if err != nil {
		if ignoreMissing(err) == nil {
			return nil, nil
		}
		return nil, err
	}
	identities := make([]string, 0, len(response.Participants))
	for _, participant := range response.Participants {
		identities = append(identities, participant.Identity)
	}
	return identities, nil
}

func (r *remoteRooms) Remove(ctx context.Context, name, identity string) error {
	ctx, err := r.authorize(ctx, name)
	if err != nil {
		return err
	}
	_, err = r.client.RemoveParticipant(ctx, &livekit.RoomParticipantIdentity{Room: name, Identity: identity})
	return ignoreMissing(err)
}

func (r *remoteRooms) SetScreenShare(ctx context.Context, name, identity string, allowed bool) error {
	ctx, err := r.authorize(ctx, name)
	if err != nil {
		return err
	}
	_, err = r.client.UpdateParticipant(ctx, &livekit.UpdateParticipantRequest{
		Room: name, Identity: identity, Permission: screenSharePermission(allowed),
	})
	if err != nil {
		// Unlike removing someone, a person who is not in the room is a real failure here.
		return fmt.Errorf("livekit update participant: %w", err)
	}
	return nil
}

// screenSharePermission is exactly what a join token grants, plus or minus the
// screen: clients still cannot publish data, administer the room or record.
func screenSharePermission(allowed bool) *livekit.ParticipantPermission {
	sources := []livekit.TrackSource{livekit.TrackSource_MICROPHONE, livekit.TrackSource_CAMERA}
	if allowed {
		sources = append(sources, livekit.TrackSource_SCREEN_SHARE, livekit.TrackSource_SCREEN_SHARE_AUDIO)
	}
	return &livekit.ParticipantPermission{CanSubscribe: true, CanPublish: true, CanPublishData: false, CanPublishSources: sources}
}

func ignoreMissing(err error) error {
	var twirpErr twirp.Error
	if errors.As(err, &twirpErr) && twirpErr.Code() == twirp.NotFound {
		return nil
	}
	if err != nil {
		return fmt.Errorf("livekit: %w", err)
	}
	return nil
}
