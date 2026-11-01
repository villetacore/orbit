package api

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/mail"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/villetacore/orbit/backend/internal/avatar"
	"github.com/villetacore/orbit/backend/internal/catalog"
	"github.com/villetacore/orbit/backend/internal/seal"
	"github.com/villetacore/orbit/backend/internal/store"
)

type assetSpec struct {
	maxBytes int64
	opts     avatar.Options
}

// Branding assets are always re-encoded to PNG; SVG and ICO are not accepted
// because they could carry active content when served from Orbit's origin.
var brandingAssets = map[string]assetSpec{
	"favicon": {maxBytes: 1 << 20, opts: avatar.Options{Square: true, MaxWidth: 256, MaxHeight: 256, MinDimension: 16, PNGOnly: true}},
	"logo":    {maxBytes: 2 << 20, opts: avatar.Options{MaxWidth: 480, MaxHeight: 160, MinDimension: 16, PNGOnly: true}},
}

type brandingView struct {
	AppName         string `json:"appName"`
	LandingTitle    string `json:"landingTitle"`
	LandingSubtitle string `json:"landingSubtitle"`
	PrimaryColor    string `json:"primaryColor"`
	AccentColor     string `json:"accentColor"`
	SupportEmail    string `json:"supportEmail"`
	SupportURL      string `json:"supportUrl"`
	FaviconURL      string `json:"faviconUrl"`
	LogoURL         string `json:"logoUrl"`
}

func viewBranding(b store.Branding) brandingView {
	v := brandingView{
		AppName:         b.AppName,
		LandingTitle:    b.LandingTitle,
		LandingSubtitle: b.LandingSubtitle,
		PrimaryColor:    b.PrimaryColor,
		AccentColor:     b.AccentColor,
		SupportEmail:    b.SupportEmail,
		SupportURL:      b.SupportURL,
	}
	assetURL := func(name string) string {
		a, ok := b.Assets[name]
		if !ok {
			return ""
		}
		return "/api/branding/" + name + "?v=" + strconv.FormatInt(a.UpdatedAt.Unix(), 10)
	}
	v.FaviconURL = assetURL("favicon")
	v.LogoURL = assetURL("logo")
	return v
}

// handleBranding is public: the landing page needs it before sign-in.
func (s *Server) handleBranding(w http.ResponseWriter, r *http.Request) {
	b, err := s.store.GetBranding(r.Context())
	if err != nil {
		s.internalError(w, "get branding", err)
		return
	}
	writeJSON(w, http.StatusOK, viewBranding(b))
}

func (s *Server) handleBrandingAsset(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "asset")
	b, err := s.store.GetBranding(r.Context())
	if err != nil {
		s.internalError(w, "get branding", err)
		return
	}
	a, ok := b.Assets[name]
	if !ok {
		writeError(w, http.StatusNotFound, "not_found", "Файл не найден")
		return
	}
	obj, err := s.avatars.Get(r.Context(), a.ObjectKey)
	if err != nil {
		if errors.Is(err, avatar.ErrObjectNotFound) {
			writeError(w, http.StatusNotFound, "not_found", "Файл не найден")
			return
		}
		s.internalError(w, "read branding asset", err)
		return
	}
	defer obj.Close()
	h := w.Header()
	h.Set("Content-Type", a.ContentType)
	h.Set("Content-Length", strconv.Itoa(a.SizeBytes))
	h.Set("Content-Security-Policy", "default-src 'none'")
	if r.URL.Query().Get("v") == strconv.FormatInt(a.UpdatedAt.Unix(), 10) {
		h.Set("Cache-Control", "public, max-age=31536000, immutable")
	} else {
		h.Set("Cache-Control", "public, max-age=300")
	}
	if _, err := io.Copy(w, obj); err != nil {
		s.log.Warn("write branding asset", "err", err)
	}
}

func (s *Server) handleAdminBranding(w http.ResponseWriter, r *http.Request) {
	b, err := s.store.GetBranding(r.Context())
	if err != nil {
		s.internalError(w, "get branding", err)
		return
	}
	writeJSON(w, http.StatusOK, viewBranding(b))
}

type brandingInput struct {
	AppName         string `json:"appName"`
	LandingTitle    string `json:"landingTitle"`
	LandingSubtitle string `json:"landingSubtitle"`
	PrimaryColor    string `json:"primaryColor"`
	AccentColor     string `json:"accentColor"`
	SupportEmail    string `json:"supportEmail"`
	SupportURL      string `json:"supportUrl"`
}

var hexColor = regexp.MustCompile(`^#[0-9A-Fa-f]{6}$`)

func (in *brandingInput) normalize() error {
	var errs []error
	var err error
	in.AppName, err = cleanText(in.AppName, 1, 40)
	errs = appendField(errs, "appName", err)
	in.LandingTitle, err = cleanText(in.LandingTitle, 0, 120)
	errs = appendField(errs, "landingTitle", err)
	in.LandingSubtitle, err = cleanText(in.LandingSubtitle, 0, 300)
	errs = appendField(errs, "landingSubtitle", err)
	for _, c := range []struct {
		field string
		value *string
	}{{"primaryColor", &in.PrimaryColor}, {"accentColor", &in.AccentColor}} {
		*c.value = strings.ToUpper(strings.TrimSpace(*c.value))
		if !hexColor.MatchString(*c.value) {
			errs = append(errs, fmt.Errorf("%s: цвет в формате #RRGGBB", c.field))
		}
	}
	in.SupportEmail = strings.TrimSpace(in.SupportEmail)
	if in.SupportEmail != "" {
		if a, err := mail.ParseAddress(in.SupportEmail); err != nil || a.Name != "" || a.Address != in.SupportEmail || len(in.SupportEmail) > 254 {
			errs = append(errs, errors.New("supportEmail: некорректный адрес"))
		}
	}
	in.SupportURL = strings.TrimSpace(in.SupportURL)
	if in.SupportURL != "" {
		if err := catalog.ValidateURL(in.SupportURL); err != nil {
			errs = append(errs, fmt.Errorf("supportUrl: %w", err))
		}
	}
	return errors.Join(errs...)
}

func (s *Server) handleAdminUpdateBranding(w http.ResponseWriter, r *http.Request) {
	var in brandingInput
	if !decodeJSON(w, r, &in) {
		return
	}
	if err := in.normalize(); err != nil {
		writeError(w, http.StatusUnprocessableEntity, "validation", err.Error())
		return
	}
	b, err := s.store.GetBranding(r.Context())
	if err != nil {
		s.internalError(w, "get branding", err)
		return
	}
	b.AppName, b.LandingTitle, b.LandingSubtitle = in.AppName, in.LandingTitle, in.LandingSubtitle
	b.PrimaryColor, b.AccentColor = in.PrimaryColor, in.AccentColor
	b.SupportEmail, b.SupportURL = in.SupportEmail, in.SupportURL
	b.UpdatedAt = time.Now().UTC()
	actor := sessionFrom(r.Context()).Claims.Subject
	if err := s.store.SaveBranding(r.Context(), b, actor); err != nil {
		s.internalError(w, "save branding", err)
		return
	}
	s.audit(r, actor, "admin.branding.update", "branding", map[string]any{
		"appName": b.AppName, "primaryColor": b.PrimaryColor, "accentColor": b.AccentColor,
	})
	writeJSON(w, http.StatusOK, viewBranding(b))
}

func (s *Server) handleAdminUploadBrandingAsset(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "asset")
	spec, ok := brandingAssets[name]
	if !ok {
		writeError(w, http.StatusNotFound, "not_found", "Неизвестный тип файла")
		return
	}
	data, contentType, ok := s.readImageUpload(w, r, spec.maxBytes, spec.opts)
	if !ok {
		return
	}
	ctx := r.Context()
	key := "branding/" + name + "/" + seal.RandomToken(12) + ".png"
	if err := s.avatars.Put(ctx, key, data, contentType); err != nil {
		s.internalError(w, "store branding asset", err)
		return
	}
	b, err := s.store.GetBranding(ctx)
	if err != nil {
		_ = s.avatars.Delete(ctx, key)
		s.internalError(w, "get branding", err)
		return
	}
	prev := b.Assets[name].ObjectKey
	if b.Assets == nil {
		b.Assets = map[string]store.Asset{}
	}
	now := time.Now().UTC()
	b.Assets[name] = store.Asset{ObjectKey: key, ContentType: contentType, SizeBytes: len(data), UpdatedAt: now}
	b.UpdatedAt = now
	actor := sessionFrom(ctx).Claims.Subject
	if err := s.store.SaveBranding(ctx, b, actor); err != nil {
		_ = s.avatars.Delete(ctx, key)
		s.internalError(w, "save branding", err)
		return
	}
	if prev != "" {
		if err := s.avatars.Delete(ctx, prev); err != nil {
			s.log.Warn("delete previous branding asset", "key", prev, "err", err)
		}
	}
	s.audit(r, actor, "admin.branding."+name, "branding", map[string]any{"sizeBytes": len(data)})
	writeJSON(w, http.StatusOK, viewBranding(b))
}

func (s *Server) handleAdminDeleteBrandingAsset(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "asset")
	if _, ok := brandingAssets[name]; !ok {
		writeError(w, http.StatusNotFound, "not_found", "Неизвестный тип файла")
		return
	}
	ctx := r.Context()
	b, err := s.store.GetBranding(ctx)
	if err != nil {
		s.internalError(w, "get branding", err)
		return
	}
	a, ok := b.Assets[name]
	if !ok {
		writeJSON(w, http.StatusOK, viewBranding(b))
		return
	}
	delete(b.Assets, name)
	b.UpdatedAt = time.Now().UTC()
	actor := sessionFrom(ctx).Claims.Subject
	if err := s.store.SaveBranding(ctx, b, actor); err != nil {
		s.internalError(w, "save branding", err)
		return
	}
	if err := s.avatars.Delete(ctx, a.ObjectKey); err != nil {
		s.log.Warn("delete branding asset", "key", a.ObjectKey, "err", err)
	}
	s.audit(r, actor, "admin.branding."+name+".delete", "branding", nil)
	writeJSON(w, http.StatusOK, viewBranding(b))
}
