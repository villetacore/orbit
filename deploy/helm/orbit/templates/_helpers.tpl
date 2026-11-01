{{- define "orbit.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "orbit.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{- define "orbit.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "orbit.labels" -}}
helm.sh/chart: {{ include "orbit.chart" . }}
{{ include "orbit.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: orbit
{{- end }}

{{- define "orbit.selectorLabels" -}}
app.kubernetes.io/name: {{ include "orbit.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{- define "orbit.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "orbit.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{- define "orbit.secretName" -}}
{{- default (include "orbit.fullname" .) .Values.secrets.existingSecret }}
{{- end }}

{{- define "orbit.image" -}}
{{- printf "%s:%s" .Values.image.repository (default .Chart.AppVersion .Values.image.tag) }}
{{- end }}

{{/* Fail early on configurations that cannot work. */}}
{{- define "orbit.validate" -}}
{{- if not (has .Values.storage.driver (list "s3" "fs")) }}
{{- fail "storage.driver must be s3 or fs" }}
{{- end }}
{{- if and (eq .Values.storage.driver "fs") (not .Values.storage.fs.persistence.existingClaim) (or (gt (int .Values.replicaCount) 1) .Values.autoscaling.enabled) (not (has "ReadWriteMany" .Values.storage.fs.persistence.accessModes)) }}
{{- fail "storage.driver=fs with several replicas needs a ReadWriteMany volume; use storage.driver=s3 or set replicaCount: 1" }}
{{- end }}
{{- if not (regexMatch "^https?://[^/]+$" .Values.config.publicUrl) }}
{{- fail "config.publicUrl must be an origin like https://orbit.example.com (no path)" }}
{{- end }}
{{- end }}
