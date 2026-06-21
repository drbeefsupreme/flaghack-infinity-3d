class_name HippieState
extends RefCounted

var id: String
var faction_id: String
var cell: Vector2i
var carrying_flag_id: String = ""
var job_id: String = ""
var attention_cost: int = 1
var distracted_ticks: int = 0
var active: bool = true

func _init(hippie_id: String = "", owner_id: String = "", start_cell: Vector2i = Vector2i.ZERO) -> void:
	id = hippie_id
	faction_id = owner_id
	cell = start_cell


func to_dict() -> Dictionary:
	return {
		"id": id,
		"faction_id": faction_id,
		"cell": {"x": cell.x, "y": cell.y},
		"carrying_flag_id": carrying_flag_id,
		"job_id": job_id,
		"attention_cost": attention_cost,
		"distracted_ticks": distracted_ticks,
		"active": active,
	}
