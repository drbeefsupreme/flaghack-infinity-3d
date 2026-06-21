class_name MapCell
extends RefCounted

var cell: Vector2i
var terrain: String = "dust"
var blocked: bool = false
var buildable: bool = true
var field_condition: String = "clear"
var movement_cost: float = 1.0
var work_modifier: float = 1.0
var visibility_modifier: float = 1.0

func _init(cell_position: Vector2i = Vector2i.ZERO) -> void:
	cell = cell_position


func apply_field_condition(condition: String) -> void:
	field_condition = condition
	match condition:
		"mud":
			movement_cost = 1.35
			work_modifier = 1.25
			visibility_modifier = 1.0
		"dust":
			movement_cost = 1.0
			work_modifier = 1.0
			visibility_modifier = 0.7
		"loud":
			movement_cost = 1.1
			work_modifier = 1.1
			visibility_modifier = 0.85
		_:
			movement_cost = 1.0
			work_modifier = 1.0
			visibility_modifier = 1.0


func to_dict() -> Dictionary:
	return {
		"cell": {"x": cell.x, "y": cell.y},
		"terrain": terrain,
		"blocked": blocked,
		"buildable": buildable,
		"field_condition": field_condition,
		"movement_cost": movement_cost,
		"work_modifier": work_modifier,
		"visibility_modifier": visibility_modifier,
	}
