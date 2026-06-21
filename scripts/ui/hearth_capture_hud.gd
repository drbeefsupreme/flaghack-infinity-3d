class_name HearthCaptureHUD
extends Control

var visible_state: Dictionary = {
	"state": "safe",
	"attacker_faction_id": "",
	"pressure": 0.0,
}

func render_state(capture_state: Dictionary) -> void:
	visible_state = capture_state.duplicate(true)
	visible = true


func is_readable() -> bool:
	return visible and visible_state.has("state") and visible_state.has("pressure")
