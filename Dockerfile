# Single image: Go API serving the exported Next.js app from ORBIT_STATIC_DIR.

FROM node:24-alpine AS web
WORKDIR /web
ENV NEXT_TELEMETRY_DISABLED=1
COPY frontend/package.json frontend/package-lock.json ./
# The design system is installed from packed archives until it is on npm.
COPY frontend/vendor ./vendor
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM golang:1.27-alpine AS api
WORKDIR /src
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
# Set by the release workflow.
ARG VERSION=dev
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w -X main.version=${VERSION}" -o /out/orbit ./cmd/orbit

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=api /out/orbit /orbit
COPY --from=web /web/out /web
ENV ORBIT_LISTEN_ADDR=:8080 \
    ORBIT_STATIC_DIR=/web \
    ORBIT_STORAGE_DIR=/home/nonroot/avatars
USER nonroot:nonroot
EXPOSE 8080
ENTRYPOINT ["/orbit"]
