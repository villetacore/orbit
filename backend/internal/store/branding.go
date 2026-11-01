package store

import "time"

// Branding is the portal's look and texts, edited by administrators.
// Empty text fields fall back to the frontend's defaults.
type Branding struct {
	AppName         string           `json:"appName"`
	LandingTitle    string           `json:"landingTitle"`
	LandingSubtitle string           `json:"landingSubtitle"`
	PrimaryColor    string           `json:"primaryColor"`
	AccentColor     string           `json:"accentColor"`
	SupportEmail    string           `json:"supportEmail"`
	SupportURL      string           `json:"supportUrl"`
	Assets          map[string]Asset `json:"assets,omitempty"`
	UpdatedAt       time.Time        `json:"updatedAt"`
}

// Asset is an uploaded branding file (favicon, logo) kept in object storage.
type Asset struct {
	ObjectKey   string    `json:"objectKey"`
	ContentType string    `json:"contentType"`
	SizeBytes   int       `json:"sizeBytes"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

// DefaultBranding uses the velessoft studio palette.
func DefaultBranding() Branding {
	return Branding{
		AppName:      "Orbit",
		PrimaryColor: "#8B7CF6",
		AccentColor:  "#B8EF65",
	}
}
