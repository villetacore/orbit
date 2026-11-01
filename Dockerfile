# Single image: Go API serving the built React app from ORBIT_STATIC_DIR.

FROM node:24-alpine AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM golang:1.27-alpine AS api
WORKDIR /src
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/orbit ./cmd/orbit

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=api /out/orbit /orbit
COPY --from=web /web/dist /web
ENV ORBIT_LISTEN_ADDR=:8080 \
    ORBIT_STATIC_DIR=/web \
    ORBIT_STORAGE_DIR=/home/nonroot/avatars
USER nonroot:nonroot
EXPOSE 8080
ENTRYPOINT ["/orbit"]
