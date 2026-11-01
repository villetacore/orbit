package api

import (
	"errors"
	"net/http"
	"net/url"
	"slices"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/villetacore/orbit/backend/internal/catalog"
	"github.com/villetacore/orbit/backend/internal/store"
)

// userService is what a regular user sees: no access rules, no raw target URL
// (navigation goes through /go/{slug}, which re-checks access and audits).
type userService struct {
	ID          string              `json:"id"`
	Slug        string              `json:"slug"`
	Name        string              `json:"name"`
	Description string              `json:"description"`
	IconURL     string              `json:"iconUrl"`
	Category    string              `json:"category"`
	Status      store.ServiceStatus `json:"status"`
	Favorite    bool                `json:"favorite"`
	LaunchURL   string              `json:"launchUrl"`
}

type servicesResponse struct {
	Services   []userService `json:"services"`
	Categories []string      `json:"categories"`
}

func (s *Server) handleListServices(w http.ResponseWriter, r *http.Request) {
	sess := sessionFrom(r.Context())
	all, err := s.store.ListServices(r.Context())
	if err != nil {
		s.internalError(w, "list services", err)
		return
	}
	favs, err := s.store.Favorites(r.Context(), sess.Claims.Subject)
	if err != nil {
		s.internalError(w, "list favorites", err)
		return
	}
	resp := servicesResponse{Services: []userService{}, Categories: []string{}}
	for _, svc := range all {
		if !catalog.VisibleTo(svc, sess.Claims.Roles) {
			continue
		}
		resp.Services = append(resp.Services, userService{
			ID: svc.ID, Slug: svc.Slug, Name: svc.Name, Description: svc.Description, IconURL: svc.IconURL,
			Category: svc.Category, Status: svc.Status, Favorite: favs[svc.ID],
			LaunchURL: "/go/" + url.PathEscape(svc.Slug),
		})
		if svc.Category != "" && !slices.Contains(resp.Categories, svc.Category) {
			resp.Categories = append(resp.Categories, svc.Category)
		}
	}
	slices.Sort(resp.Categories)
	writeJSON(w, http.StatusOK, resp)
}

// visibleService loads a service by ID and hides it (404) from users who may
// not see it, so IDs of restricted services cannot be probed.
func (s *Server) visibleService(r *http.Request, id string) (*store.Service, error) {
	svc, err := s.store.GetService(r.Context(), id)
	if err != nil {
		return nil, err
	}
	if !catalog.VisibleTo(*svc, sessionFrom(r.Context()).Claims.Roles) {
		return nil, store.ErrNotFound
	}
	return svc, nil
}

func (s *Server) handleSetFavorite(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Favorite bool `json:"favorite"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	svc, err := s.visibleService(r, chi.URLParam(r, "id"))
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "not_found", "Сервис не найден")
		return
	}
	if err != nil {
		s.internalError(w, "get service", err)
		return
	}
	if err := s.store.SetFavorite(r.Context(), sessionFrom(r.Context()).Claims.Subject, svc.ID, in.Favorite); err != nil {
		s.internalError(w, "set favorite", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleLaunch is the SSO entry point for a catalog service: it checks access
// on the server, records the transition and redirects. The target application
// authenticates the user against the same Keycloak realm, so no new login is
// needed while the Keycloak session is alive.
func (s *Server) handleLaunch(w http.ResponseWriter, r *http.Request) {
	ref := chi.URLParam(r, "ref")
	sess, err := s.currentSession(r)
	if err != nil {
		http.Redirect(w, r, "/auth/login?return_to="+url.QueryEscape("/go/"+ref), http.StatusFound)
		return
	}
	all, err := s.store.ListServices(r.Context())
	if err != nil {
		s.internalError(w, "list services", err)
		return
	}
	idx := slices.IndexFunc(all, func(svc store.Service) bool { return svc.Slug == ref || svc.ID == ref })
	if idx < 0 || !catalog.VisibleTo(all[idx], sess.Claims.Roles) || catalog.ValidateURL(all[idx].URL) != nil {
		http.Redirect(w, r, "/services?unavailable="+url.QueryEscape(ref), http.StatusFound)
		return
	}
	svc := all[idx]
	s.audit(r, sess.Claims.Subject, "service.launch", svc.Slug, nil)
	w.Header().Set("Cache-Control", "no-store")
	http.Redirect(w, r, svc.URL, http.StatusFound)
}

// --- admin ---

func (s *Server) handleAdminListServices(w http.ResponseWriter, r *http.Request) {
	all, err := s.store.ListServices(r.Context())
	if err != nil {
		s.internalError(w, "list services", err)
		return
	}
	if all == nil {
		all = []store.Service{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"services": all})
}

func (s *Server) handleAdminCreateService(w http.ResponseWriter, r *http.Request) {
	in, ok := s.decodeServiceInput(w, r)
	if !ok {
		return
	}
	svc, err := s.store.CreateService(r.Context(), in)
	if !s.serviceWriteOK(w, err) {
		return
	}
	s.audit(r, sessionFrom(r.Context()).Claims.Subject, "admin.service.create", svc.Slug, map[string]any{"id": svc.ID})
	writeJSON(w, http.StatusCreated, svc)
}

func (s *Server) handleAdminUpdateService(w http.ResponseWriter, r *http.Request) {
	in, ok := s.decodeServiceInput(w, r)
	if !ok {
		return
	}
	svc, err := s.store.UpdateService(r.Context(), chi.URLParam(r, "id"), in)
	if !s.serviceWriteOK(w, err) {
		return
	}
	s.audit(r, sessionFrom(r.Context()).Claims.Subject, "admin.service.update", svc.Slug, map[string]any{
		"id": svc.ID, "status": svc.Status, "requiredRoles": svc.RequiredRoles,
	})
	writeJSON(w, http.StatusOK, svc)
}

func (s *Server) handleAdminDeleteService(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	svc, err := s.store.GetService(r.Context(), id)
	if !s.serviceWriteOK(w, err) {
		return
	}
	if !s.serviceWriteOK(w, s.store.DeleteService(r.Context(), id)) {
		return
	}
	s.audit(r, sessionFrom(r.Context()).Claims.Subject, "admin.service.delete", svc.Slug, map[string]any{"id": id})
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) decodeServiceInput(w http.ResponseWriter, r *http.Request) (store.ServiceInput, bool) {
	var in store.ServiceInput
	if !decodeJSON(w, r, &in) {
		return in, false
	}
	in, err := catalog.Normalize(in)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, "validation", err.Error())
		return in, false
	}
	return in, true
}

func (s *Server) serviceWriteOK(w http.ResponseWriter, err error) bool {
	switch {
	case err == nil:
		return true
	case errors.Is(err, store.ErrNotFound):
		writeError(w, http.StatusNotFound, "not_found", "Сервис не найден")
	case errors.Is(err, store.ErrConflict):
		writeError(w, http.StatusConflict, "conflict", "Сервис с таким slug уже существует")
	default:
		s.internalError(w, "write service", err)
	}
	return false
}

func (s *Server) handleAdminAudit(w http.ResponseWriter, r *http.Request) {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	before, _ := strconv.ParseInt(r.URL.Query().Get("before"), 10, 64)
	events, err := s.store.ListAudit(r.Context(), limit, before)
	if err != nil {
		s.internalError(w, "list audit", err)
		return
	}
	if events == nil {
		events = []store.AuditEvent{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"events": events})
}

func (s *Server) internalError(w http.ResponseWriter, op string, err error) {
	s.log.Error(op, "err", err)
	writeError(w, http.StatusInternalServerError, "internal", "Внутренняя ошибка")
}
