class_name DebugOverlay
extends Node

var enabled_layers: Dictionary = {
	"survey_vertices": true,
	"fulfilled_vertices": true,
	"closed_regions": true,
	"capture_state": true,
	"instability": true,
	"attention": true,
	"jobs": true,
	"drugs": true,
	"abilities": true,
	"npc_intent": true,
}
var last_snapshot_hash: String = ""
var last_snapshot: Dictionary = {}

func render_from(snapshot: Dictionary) -> void:
	last_snapshot = snapshot.duplicate(true)
	last_snapshot_hash = JSON.stringify(last_snapshot).sha256_text()


func set_layer_enabled(layer: String, enabled: bool) -> void:
	if enabled_layers.has(layer):
		enabled_layers[layer] = enabled
