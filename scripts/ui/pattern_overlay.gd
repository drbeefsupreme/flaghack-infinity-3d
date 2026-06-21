class_name PatternOverlay
extends Node2D

var target_cells: Array[Vector2i] = []
var fulfilled_cells: Array[Vector2i] = []
var capture_state: Dictionary = {
	"state": "safe",
	"attacker_faction_id": "",
	"pressure": 0.0,
}
var instability_events: Array[Dictionary] = []

func render_from(pattern: SurveyPattern, new_capture_state: Dictionary, new_instability_events: Array[Dictionary] = []) -> void:
	target_cells = pattern.target_cells()
	fulfilled_cells = pattern.fulfilled_cells()
	capture_state = new_capture_state.duplicate(true)
	instability_events = new_instability_events.duplicate(true)
	visible = true


func has_capture_feedback() -> bool:
	return capture_state.get("state", "safe") != "safe"
