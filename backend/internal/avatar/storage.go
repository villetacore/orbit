package avatar

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

var ErrObjectNotFound = errors.New("object not found")

// Storage is an object store for avatar files.
type Storage interface {
	Put(ctx context.Context, key string, data []byte, contentType string) error
	Get(ctx context.Context, key string) (io.ReadCloser, error)
	Delete(ctx context.Context, key string) error
}

var keyPattern = regexp.MustCompile(`^[A-Za-z0-9_-]+(/[A-Za-z0-9_-]+)*(\.[a-z]+)?$`)

func checkKey(key string) error {
	if !keyPattern.MatchString(key) {
		return fmt.Errorf("invalid object key %q", key)
	}
	return nil
}

// FS stores objects on the local filesystem; suitable for development and
// single-node deployments.
type FS struct{ dir string }

func NewFS(dir string) (*FS, error) {
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return nil, err
	}
	return &FS{dir: dir}, nil
}

func (f *FS) path(key string) (string, error) {
	if err := checkKey(key); err != nil {
		return "", err
	}
	return filepath.Join(f.dir, filepath.FromSlash(key)), nil
}

func (f *FS) Put(_ context.Context, key string, data []byte, _ string) error {
	p, err := f.path(key)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o750); err != nil {
		return err
	}
	tmp := p + ".tmp"
	if err := os.WriteFile(tmp, data, 0o640); err != nil {
		return err
	}
	return os.Rename(tmp, p)
}

func (f *FS) Get(_ context.Context, key string) (io.ReadCloser, error) {
	p, err := f.path(key)
	if err != nil {
		return nil, err
	}
	file, err := os.Open(p)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, ErrObjectNotFound
	}
	return file, err
}

func (f *FS) Delete(_ context.Context, key string) error {
	p, err := f.path(key)
	if err != nil {
		return err
	}
	if err := os.Remove(p); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	return nil
}

// S3 stores objects in an S3-compatible bucket (MinIO, Ceph, AWS S3).
type S3 struct {
	client *minio.Client
	bucket string
}

func NewS3(ctx context.Context, endpoint, accessKey, secretKey, bucket string, useSSL bool) (*S3, error) {
	client, err := minio.New(endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(accessKey, secretKey, ""),
		Secure: useSSL,
	})
	if err != nil {
		return nil, err
	}
	exists, err := client.BucketExists(ctx, bucket)
	if err != nil {
		return nil, fmt.Errorf("check bucket: %w", err)
	}
	if !exists {
		if err := client.MakeBucket(ctx, bucket, minio.MakeBucketOptions{}); err != nil {
			return nil, fmt.Errorf("create bucket: %w", err)
		}
	}
	return &S3{client: client, bucket: bucket}, nil
}

func (s *S3) Put(ctx context.Context, key string, data []byte, contentType string) error {
	if err := checkKey(key); err != nil {
		return err
	}
	_, err := s.client.PutObject(ctx, s.bucket, key, bytes.NewReader(data), int64(len(data)),
		minio.PutObjectOptions{ContentType: contentType})
	return err
}

func (s *S3) Get(ctx context.Context, key string) (io.ReadCloser, error) {
	if err := checkKey(key); err != nil {
		return nil, err
	}
	obj, err := s.client.GetObject(ctx, s.bucket, key, minio.GetObjectOptions{})
	if err != nil {
		return nil, err
	}
	if _, err := obj.Stat(); err != nil {
		obj.Close()
		if minio.ToErrorResponse(err).Code == "NoSuchKey" {
			return nil, ErrObjectNotFound
		}
		return nil, err
	}
	return obj, nil
}

func (s *S3) Delete(ctx context.Context, key string) error {
	if err := checkKey(key); err != nil {
		return err
	}
	return s.client.RemoveObject(ctx, s.bucket, key, minio.RemoveObjectOptions{})
}

// Memory is an in-process Storage used by tests.
type Memory struct{ Objects map[string][]byte }

func NewMemory() *Memory { return &Memory{Objects: map[string][]byte{}} }

func (m *Memory) Put(_ context.Context, key string, data []byte, _ string) error {
	if err := checkKey(key); err != nil {
		return err
	}
	m.Objects[key] = data
	return nil
}

func (m *Memory) Get(_ context.Context, key string) (io.ReadCloser, error) {
	d, ok := m.Objects[key]
	if !ok {
		return nil, ErrObjectNotFound
	}
	return io.NopCloser(bytes.NewReader(d)), nil
}

func (m *Memory) Delete(_ context.Context, key string) error {
	delete(m.Objects, key)
	return nil
}
