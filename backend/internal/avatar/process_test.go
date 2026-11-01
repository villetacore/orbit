package avatar

import (
	"bytes"
	"errors"
	"image"
	"image/color"
	"image/gif"
	"image/jpeg"
	"image/png"
	"testing"
)

func encodePNG(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	img.Set(0, 0, color.White)
	var b bytes.Buffer
	if err := png.Encode(&b, img); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func TestProcessNormalizesToSquare(t *testing.T) {
	out, mime, err := Process(bytes.NewReader(encodePNG(t, 1200, 700)), 5<<20)
	if err != nil {
		t.Fatal(err)
	}
	if mime != "image/png" {
		t.Fatalf("mime %q", mime)
	}
	img, err := png.Decode(bytes.NewReader(out))
	if err != nil {
		t.Fatal(err)
	}
	if b := img.Bounds(); b.Dx() != OutputSize || b.Dy() != OutputSize {
		t.Fatalf("size %v", b)
	}
}

func TestProcessKeepsSmallImagesSmall(t *testing.T) {
	out, _, err := Process(bytes.NewReader(encodePNG(t, 100, 200)), 5<<20)
	if err != nil {
		t.Fatal(err)
	}
	cfg, _ := png.DecodeConfig(bytes.NewReader(out))
	if cfg.Width != 100 || cfg.Height != 100 {
		t.Fatalf("size %dx%d", cfg.Width, cfg.Height)
	}
}

func TestProcessJPEGStaysJPEG(t *testing.T) {
	var b bytes.Buffer
	if err := jpeg.Encode(&b, image.NewRGBA(image.Rect(0, 0, 300, 300)), nil); err != nil {
		t.Fatal(err)
	}
	// Trailing payload (polyglot file) must not survive re-encoding.
	b.WriteString("<script>alert(1)</script>")
	out, mime, err := Process(bytes.NewReader(b.Bytes()), 5<<20)
	if err != nil || mime != "image/jpeg" {
		t.Fatalf("%v %q", err, mime)
	}
	if bytes.Contains(out, []byte("<script>")) {
		t.Fatal("payload survived re-encoding")
	}
}

func TestProcessRejects(t *testing.T) {
	var gifBuf bytes.Buffer
	_ = gif.Encode(&gifBuf, image.NewPaletted(image.Rect(0, 0, 100, 100), []color.Color{color.Black}), nil)

	// PNG signature followed by garbage: sniffs as PNG but does not decode.
	broken := append([]byte("\x89PNG\r\n\x1a\n"), bytes.Repeat([]byte{0}, 64)...)

	cases := []struct {
		name string
		data []byte
		max  int64
		want error
	}{
		{"too large", encodePNG(t, 200, 200), 100, ErrTooLarge},
		{"svg", []byte(`<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>`), 5 << 20, ErrUnsupportedType},
		{"gif", gifBuf.Bytes(), 5 << 20, ErrUnsupportedType},
		{"broken png", broken, 5 << 20, ErrInvalidImage},
		{"too small", encodePNG(t, 10, 10), 5 << 20, ErrDimensions},
		{"too big", encodePNG(t, MaxDimension+1, 64), 50 << 20, ErrDimensions},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if _, _, err := Process(bytes.NewReader(c.data), c.max); !errors.Is(err, c.want) {
				t.Fatalf("got %v, want %v", err, c.want)
			}
		})
	}
}

func TestFSRejectsTraversal(t *testing.T) {
	fs, err := NewFS(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"../etc/passwd", "/abs", "a/../../b", "a//b", ""} {
		if err := fs.Put(t.Context(), key, []byte("x"), "text/plain"); err == nil {
			t.Errorf("key %q accepted", key)
		}
	}
	if err := fs.Put(t.Context(), "avatars/abc/def.png", []byte("x"), "image/png"); err != nil {
		t.Fatal(err)
	}
}

func TestProcessImageKeepsAspectForLogos(t *testing.T) {
	var b bytes.Buffer
	if err := jpeg.Encode(&b, image.NewRGBA(image.Rect(0, 0, 1200, 300)), nil); err != nil {
		t.Fatal(err)
	}
	out, mime, err := ProcessImage(bytes.NewReader(b.Bytes()), 5<<20, Options{MaxWidth: 480, MaxHeight: 160, MinDimension: 16, PNGOnly: true})
	if err != nil || mime != "image/png" {
		t.Fatalf("%v %q", err, mime)
	}
	cfg, _ := png.DecodeConfig(bytes.NewReader(out))
	if cfg.Width != 480 || cfg.Height != 120 {
		t.Fatalf("size %dx%d", cfg.Width, cfg.Height)
	}
}
