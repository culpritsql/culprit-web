{{- define "culprit-fleet.fullname" -}}
{{- printf "%s-culprit-fleet" .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- define "culprit-fleet.selector" -}}
app.kubernetes.io/name: culprit-fleet
app.kubernetes.io/instance: {{ .Release.Name | quote }}
{{- end -}}
{{- define "culprit-fleet.config" -}}
{{- if and .Values.config.existingConfigMap .Values.config.files -}}{{ fail "choose config.existingConfigMap or config.files" }}{{- end -}}
{{- if .Values.config.existingConfigMap -}}{{ .Values.config.existingConfigMap }}
{{- else if hasKey .Values.config.files "web.json" -}}{{ include "culprit-fleet.fullname" . }}
{{- else -}}{{ fail "configure config.files with web.json or name an existingConfigMap" }}
{{- end -}}
{{- end -}}
{{- define "culprit-fleet.image" -}}
{{- if .Values.image -}}
{{- .Values.image -}}
{{- else if .Values.imageDigest -}}
{{- printf "%s@%s" .Values.imageRepository .Values.imageDigest -}}
{{- else if .Values.imageTag -}}
{{- printf "%s:%s" .Values.imageRepository .Values.imageTag -}}
{{- else -}}
{{- printf "%s:v%s" .Values.imageRepository .Chart.AppVersion -}}
{{- end -}}
{{- end -}}
