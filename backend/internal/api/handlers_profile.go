package api

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"

	"github.com/villetacore/orbit/backend/internal/avatar"
	"github.com/villetacore/orbit/backend/internal/keycloak"
	"github.com/villetacore/orbit/backend/internal/seal"
	"github.com/villetacore/orbit/backend/internal/store"
)

type attributeView struct {
	Name     string `json:"name"`
	Value    string `json:"value"`
	Editable bool   `json:"editable"`
}

type profileView struct {
	Sub           string          `json:"sub"`
	Username      string          `json:"username"`
	Email         string          `json:"email"`
	EmailVerified bool            `json:"emailVerified"`
	FirstName     string          `json:"firstName"`
	LastName      string          `json:"lastName"`
	Enabled       bool            `json:"enabled"`
	CreatedAt     *time.Time      `json:"createdAt"`
	Attributes    []attributeView `json:"attributes"`
	Groups        []string        `json:"groups"`
	Roles         []string        `json:"roles"`
	AvatarURL     string          `json:"avatarUrl"`
}

func (s *Server) profileFor(r *http.Request, u *keycloak.User) (profileView, error) {
	sess := sessionFrom(r.Context())
	groups, err := s.kc.UserGroups(r.Context(), u.ID)
	if err != nil {
		return profileView{}, err
	}
	p := profileView{
		Sub:           u.ID,
		Username:      u.Username,
		Email:         u.Email,
		EmailVerified: u.EmailVerified,
		FirstName:     u.FirstName,
		LastName:      u.LastName,
		Enabled:       u.Enabled,
		Attributes:    []attributeView{},
		Groups:        []string{},
		Roles:         displayRoles(sess.Claims.Roles),
		AvatarURL:     s.avatarURLFor(r, u.ID),
	}
	if u.CreatedTimestamp > 0 {
		t := time.UnixMilli(u.CreatedTimestamp).UTC()
		p.CreatedAt = &t
	}
	for _, name := range s.cfg.EditableAttributes {
		p.Attributes = append(p.Attributes, attributeView{Name: name, Value: u.Attr(name), Editable: true})
	}
	for _, name := range s.cfg.VisibleAttributes {
		if !slices.Contains(s.cfg.EditableAttributes, name) {
			p.Attributes = append(p.Attributes, attributeView{Name: name, Value: u.Attr(name)})
		}
	}
	for _, g := range groups {
		p.Groups = append(p.Groups, g.Path)
	}
	return p, nil
}

func (s *Server) handleGetProfile(w http.ResponseWriter, r *http.Request) {
	sub := sessionFrom(r.Context()).Claims.Subject
	u, err := s.kc.GetUser(r.Context(), sub)
	if err != nil {
		s.keycloakError(w, err)
		return
	}
	p, err := s.profileFor(r, u)
	if err != nil {
		s.keycloakError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, p)
}

type profileUpdate struct {
	FirstName  *string           `json:"firstName"`
	LastName   *string           `json:"lastName"`
	Attributes map[string]string `json:"attributes"`
}

func (s *Server) handleUpdateProfile(w http.ResponseWriter, r *http.Request) {
	var in profileUpdate
	if !decodeJSON(w, r, &in) {
		return
	}
	var errs []error
	if in.FirstName != nil {
		v, err := cleanText(*in.FirstName, 1, 100)
		errs = appendField(errs, "firstName", err)
		in.FirstName = &v
	}
	if in.LastName != nil {
		v, err := cleanText(*in.LastName, 1, 100)
		errs = appendField(errs, "lastName", err)
		in.LastName = &v
	}
	for name, value := range in.Attributes {
		// Only attributes explicitly configured as user-editable can be written.
		if !slices.Contains(s.cfg.EditableAttributes, name) {
			errs = append(errs, fmt.Errorf("%s: поле нельзя изменять", name))
			continue
		}
		v, err := cleanText(value, 0, 255)
		errs = appendField(errs, name, err)
		in.Attributes[name] = v
	}
	if err := errors.Join(errs...); err != nil {
		writeError(w, http.StatusUnprocessableEntity, "validation", err.Error())
		return
	}

	sub := sessionFrom(r.Context()).Claims.Subject
	u, err := s.kc.GetUser(r.Context(), sub)
	if err != nil {
		s.keycloakError(w, err)
		return
	}
	var changed []string
	if in.FirstName != nil && *in.FirstName != u.FirstName {
		u.FirstName = *in.FirstName
		changed = append(changed, "firstName")
	}
	if in.LastName != nil && *in.LastName != u.LastName {
		u.LastName = *in.LastName
		changed = append(changed, "lastName")
	}
	for name, value := range in.Attributes {
		if u.Attr(name) != value {
			u.SetAttr(name, value)
			changed = append(changed, name)
		}
	}
	if len(changed) > 0 {
		if err := s.kc.UpdateUser(r.Context(), u); err != nil {
			s.keycloakError(w, err)
			return
		}
		slices.Sort(changed)
		// Field names only: values may be personal data.
		s.audit(r, sub, "profile.update", sub, map[string]any{"fields": changed})
	}
	p, err := s.profileFor(r, u)
	if err != nil {
		s.keycloakError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, p)
}

func cleanText(v string, minLen, maxLen int) (string, error) {
	v = strings.TrimSpace(v)
	if !utf8.ValidString(v) {
		return "", errors.New("недопустимые символы")
	}
	if strings.IndexFunc(v, unicode.IsControl) >= 0 {
		return "", errors.New("недопустимые управляющие символы")
	}
	n := utf8.RuneCountInString(v)
	if n < minLen {
		return "", errors.New("обязательное поле")
	}
	if n > maxLen {
		return "", fmt.Errorf("не более %d символов", maxLen)
	}
	return v, nil
}

func appendField(errs []error, field string, err error) []error {
	if err != nil {
		return append(errs, fmt.Errorf("%s: %w", field, err))
	}
	return errs
}

func (s *Server) keycloakError(w http.ResponseWriter, err error) {
	if errors.Is(err, keycloak.ErrNotFound) {
		writeError(w, http.StatusNotFound, "not_found", "Учётная запись не найдена в Keycloak")
		return
	}
	s.log.Error("keycloak", "err", err)
	writeError(w, http.StatusBadGateway, "keycloak", "Ошибка обращения к Keycloak")
}

// --- avatar ---

func avatarPath(sub string, uploadedAt time.Time) string {
	return "/api/users/" + url.PathEscape(sub) + "/avatar?v=" + strconv.FormatInt(uploadedAt.Unix(), 10)
}

// avatarURLFor returns the relative avatar URL for sub, or "" if none is set.
func (s *Server) avatarURLFor(r *http.Request, sub string) string {
	a, err := s.store.GetAvatar(r.Context(), sub)
	if err != nil {
		if !errors.Is(err, store.ErrNotFound) {
			s.log.Error("get avatar", "err", err)
		}
		return ""
	}
	return avatarPath(sub, a.UploadedAt)
}

func (s *Server) handleUploadAvatar(w http.ResponseWriter, r *http.Request) {
	sub := sessionFrom(r.Context()).Claims.Subject
	data, contentType, ok := s.readImageUpload(w, r, s.cfg.AvatarMaxBytes, avatar.AvatarOptions)
	if !ok {
		return
	}

	ext := ".png"
	if contentType == "image/jpeg" {
		ext = ".jpg"
	}
	// The object key is derived from a hash of sub plus a random part, so it
	// is safe as a path and changes on every upload (cache busting).
	key := "avatars/" + seal.Hash(sub)[:32] + "/" + seal.RandomToken(12) + ext
	ctx := r.Context()
	if err := s.avatars.Put(ctx, key, data, contentType); err != nil {
		s.log.Error("store avatar", "err", err)
		writeError(w, http.StatusInternalServerError, "storage", "Не удалось сохранить файл")
		return
	}
	now := time.Now().UTC()
	prev, err := s.store.SetAvatar(ctx, store.Avatar{
		Sub: sub, ObjectKey: key, ContentType: contentType, SizeBytes: len(data), UploadedAt: now,
	})
	if err != nil {
		_ = s.avatars.Delete(context.WithoutCancel(ctx), key)
		s.log.Error("save avatar metadata", "err", err)
		writeError(w, http.StatusInternalServerError, "internal", "Не удалось сохранить аватар")
		return
	}
	if prev != "" && prev != key {
		if err := s.avatars.Delete(ctx, prev); err != nil {
			s.log.Warn("delete previous avatar", "key", prev, "err", err)
		}
	}
	path := avatarPath(sub, now)
	s.syncPicture(ctx, sub, s.cfg.PublicURL+path)
	s.audit(r, sub, "avatar.upload", sub, map[string]any{"contentType": contentType, "sizeBytes": len(data)})
	writeJSON(w, http.StatusOK, map[string]string{"avatarUrl": path})
}

func (s *Server) handleDeleteAvatar(w http.ResponseWriter, r *http.Request) {
	sub := sessionFrom(r.Context()).Claims.Subject
	key, err := s.store.DeleteAvatar(r.Context(), sub)
	if errors.Is(err, store.ErrNotFound) {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if err != nil {
		s.log.Error("delete avatar", "err", err)
		writeError(w, http.StatusInternalServerError, "internal", "Не удалось удалить аватар")
		return
	}
	if err := s.avatars.Delete(r.Context(), key); err != nil {
		s.log.Warn("delete avatar object", "key", key, "err", err)
	}
	s.syncPicture(r.Context(), sub, "")
	s.audit(r, sub, "avatar.delete", sub, nil)
	w.WriteHeader(http.StatusNoContent)
}

// readImageUpload reads the multipart "file" field and normalizes it with
// avatar.ProcessImage, writing an error response when it fails.
func (s *Server) readImageUpload(w http.ResponseWriter, r *http.Request, maxBytes int64, opts avatar.Options) ([]byte, string, bool) {
	r.Body = http.MaxBytesReader(w, r.Body, maxBytes+64<<10)
	if err := r.ParseMultipartForm(maxBytes); err != nil {
		var mbe *http.MaxBytesError
		if errors.As(err, &mbe) {
			writeError(w, http.StatusRequestEntityTooLarge, "too_large", "Файл слишком большой")
			return nil, "", false
		}
		writeError(w, http.StatusBadRequest, "bad_request", "Ожидается multipart/form-data с полем file")
		return nil, "", false
	}
	defer r.MultipartForm.RemoveAll() //nolint:errcheck
	file, _, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "Поле file не найдено")
		return nil, "", false
	}
	defer file.Close()

	data, contentType, err := avatar.ProcessImage(file, maxBytes, opts)
	switch {
	case errors.Is(err, avatar.ErrTooLarge):
		writeError(w, http.StatusRequestEntityTooLarge, "too_large", "Файл слишком большой")
	case errors.Is(err, avatar.ErrUnsupportedType):
		writeError(w, http.StatusUnsupportedMediaType, "unsupported_type", "Поддерживаются PNG, JPEG и WebP")
	case errors.Is(err, avatar.ErrInvalidImage), errors.Is(err, avatar.ErrDimensions):
		writeError(w, http.StatusUnprocessableEntity, "invalid_image",
			fmt.Sprintf("Изображение повреждено или его размер вне диапазона %d–%d px", opts.MinDimension, avatar.MaxDimension))
	case err != nil:
		s.log.Error("process image", "err", err)
		writeError(w, http.StatusInternalServerError, "internal", "Не удалось обработать изображение")
	default:
		return data, contentType, true
	}
	return nil, "", false
}

// syncPicture publishes the avatar URL as the Keycloak "picture" attribute so
// other SSO applications receive it in the standard OIDC picture claim.
// Best-effort: Orbit's own storage is the source of truth.
func (s *Server) syncPicture(ctx context.Context, sub, pictureURL string) {
	ctx = context.WithoutCancel(ctx)
	u, err := s.kc.GetUser(ctx, sub)
	if err == nil {
		if u.Attr("picture") == pictureURL {
			return
		}
		u.SetAttr("picture", pictureURL)
		err = s.kc.UpdateUser(ctx, u)
	}
	if err != nil {
		s.log.Warn("sync picture attribute", "sub", sub, "err", err)
	}
}

// handleGetAvatar serves avatars publicly so other corporate applications can
// embed them via the picture claim. Keys are looked up by sub; the response
// is always an image re-encoded by Orbit.
func (s *Server) handleGetAvatar(w http.ResponseWriter, r *http.Request) {
	sub := chi.URLParam(r, "sub")
	a, err := s.store.GetAvatar(r.Context(), sub)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "not_found", "Аватар не найден")
		return
	}
	if err != nil {
		s.log.Error("get avatar", "err", err)
		writeError(w, http.StatusInternalServerError, "internal", "Ошибка чтения аватара")
		return
	}
	obj, err := s.avatars.Get(r.Context(), a.ObjectKey)
	if errors.Is(err, avatar.ErrObjectNotFound) {
		writeError(w, http.StatusNotFound, "not_found", "Аватар не найден")
		return
	}
	if err != nil {
		s.log.Error("read avatar object", "err", err)
		writeError(w, http.StatusInternalServerError, "internal", "Ошибка чтения аватара")
		return
	}
	defer obj.Close()

	h := w.Header()
	h.Set("Content-Type", a.ContentType)
	h.Set("Content-Length", strconv.Itoa(a.SizeBytes))
	h.Set("Content-Security-Policy", "default-src 'none'")
	h.Set("Cross-Origin-Resource-Policy", "cross-origin")
	if r.URL.Query().Get("v") == strconv.FormatInt(a.UploadedAt.Unix(), 10) {
		h.Set("Cache-Control", "public, max-age=31536000, immutable")
	} else {
		h.Set("Cache-Control", "public, max-age=300")
	}
	if _, err := io.Copy(w, obj); err != nil {
		s.log.Warn("write avatar", "err", err)
	}
}
