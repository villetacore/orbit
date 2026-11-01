// Package avatar validates uploaded profile images and stores them.
package avatar

import (
	"bytes"
	"errors"
	"image"
	"image/jpeg"
	"image/png"
	"io"
	"net/http"

	"golang.org/x/image/draw"
	_ "golang.org/x/image/webp" // register WebP decoder
)

const (
	MaxDimension = 4096
	MinDimension = 64
	OutputSize   = 512
)

var (
	ErrTooLarge        = errors.New("file is too large")
	ErrUnsupportedType = errors.New("unsupported image type; use PNG, JPEG or WebP")
	ErrInvalidImage    = errors.New("file is not a valid image")
	ErrDimensions      = errors.New("image dimensions are out of range")
)

// sniffed MIME type -> image package format name
var allowed = map[string]string{
	"image/png":  "png",
	"image/jpeg": "jpeg",
	"image/webp": "webp",
}

// Options controls how ProcessImage normalizes an image.
type Options struct {
	// Square crops to a centered square of at most MaxWidth pixels.
	Square bool
	// MaxWidth and MaxHeight bound the output; the aspect ratio is kept.
	MaxWidth, MaxHeight int
	// MinDimension is the smallest accepted width and height of the source.
	MinDimension int
	// PNGOnly always encodes PNG (keeps transparency); otherwise JPEG
	// sources stay JPEG.
	PNGOnly bool
}

// AvatarOptions are used for profile photos.
var AvatarOptions = Options{Square: true, MaxWidth: OutputSize, MaxHeight: OutputSize, MinDimension: MinDimension}

// Process normalizes a profile photo; see ProcessImage.
func Process(r io.Reader, maxBytes int64) ([]byte, string, error) {
	return ProcessImage(r, maxBytes, AvatarOptions)
}

// ProcessImage checks size, MIME type (by content, not by the client's
// header), dimensions and decodability, then re-encodes the image within the
// bounds of opts. Re-encoding drops metadata (EXIF, GPS) and any payload
// appended to the file.
func ProcessImage(r io.Reader, maxBytes int64, opts Options) ([]byte, string, error) {
	data, err := io.ReadAll(io.LimitReader(r, maxBytes+1))
	if err != nil {
		return nil, "", err
	}
	if int64(len(data)) > maxBytes {
		return nil, "", ErrTooLarge
	}
	format, ok := allowed[http.DetectContentType(data)]
	if !ok {
		return nil, "", ErrUnsupportedType
	}

	cfg, cfgFormat, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || cfgFormat != format {
		return nil, "", ErrInvalidImage
	}
	if cfg.Width < opts.MinDimension || cfg.Height < opts.MinDimension || cfg.Width > MaxDimension || cfg.Height > MaxDimension {
		return nil, "", ErrDimensions
	}
	src, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, "", ErrInvalidImage
	}

	b := src.Bounds()
	crop := b
	if opts.Square {
		side := min(b.Dx(), b.Dy())
		crop = image.Rect(0, 0, side, side).Add(b.Min).Add(image.Pt((b.Dx()-side)/2, (b.Dy()-side)/2))
	}
	scale := min(1, float64(opts.MaxWidth)/float64(crop.Dx()), float64(opts.MaxHeight)/float64(crop.Dy()))
	w := max(1, int(float64(crop.Dx())*scale+0.5))
	h := max(1, int(float64(crop.Dy())*scale+0.5))
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	draw.CatmullRom.Scale(dst, dst.Bounds(), src, crop, draw.Src, nil)

	var out bytes.Buffer
	if format == "jpeg" && !opts.PNGOnly {
		if err := jpeg.Encode(&out, dst, &jpeg.Options{Quality: 88}); err != nil {
			return nil, "", err
		}
		return out.Bytes(), "image/jpeg", nil
	}
	if err := png.Encode(&out, dst); err != nil {
		return nil, "", err
	}
	return out.Bytes(), "image/png", nil
}
