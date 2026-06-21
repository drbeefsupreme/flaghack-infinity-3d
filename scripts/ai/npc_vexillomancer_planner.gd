class_name NPCVexillomancerPlanner
extends RefCounted

const PlannerViewScript = preload("res://scripts/ai/planner_view.gd")

var profile: NPCStrategyProfile
var view_builder: PlannerView = PlannerViewScript.new()

func _init(strategy_profile: NPCStrategyProfile = null) -> void:
	profile = strategy_profile if strategy_profile != null else NPCStrategyProfile.expand_heavy()


func plan_tick(state: MatchState, burn_map: BurnMapGenerator, faction_id: String, tick: int) -> Array[Dictionary]:
	var view := view_builder.from_state(state, faction_id)
	if view.is_empty() or not bool(view.active):
		return []
	if int(view.attention_available) <= 0:
		return []

	var available_attention := int(view.attention_available)
	if profile.raid_weight > profile.expand_weight and not view.visible_buildings.is_empty():
		return [_raid_order(faction_id, tick, view.visible_buildings[0].id, mini(2, available_attention))]

	var target_cell := _next_survey_target(state, burn_map, faction_id)
	if target_cell == Vector2i(-1, -1):
		return []

	return [{
		"id": "%s_survey_%d" % [faction_id, tick],
		"tick": tick,
		"actor_id": "%s_vex" % faction_id,
		"faction_id": faction_id,
		"type": "assign_survey_work",
		"payload": {
			"target_cell": target_cell,
			"attention": mini(2, available_attention),
		},
	}]


func _raid_order(faction_id: String, tick: int, target_building_id: String, attention: int) -> Dictionary:
	return {
		"id": "%s_raid_%d" % [faction_id, tick],
		"tick": tick,
		"actor_id": "%s_vex" % faction_id,
		"faction_id": faction_id,
		"type": "raid_building",
		"payload": {
			"target_building_id": target_building_id,
			"attention": attention,
		},
	}


func _next_survey_target(state: MatchState, burn_map: BurnMapGenerator, faction_id: String) -> Vector2i:
	var pattern := burn_map.pattern_for_faction(faction_id)
	for target_cell in pattern.target_cells():
		if not _has_flag_at(state, target_cell) and not _has_job_for(state, faction_id, target_cell):
			return target_cell
	return Vector2i(-1, -1)


func _has_flag_at(state: MatchState, cell: Vector2i) -> bool:
	for flag in state.flags.values():
		if flag.cell == cell and flag.carried_by == "":
			return true
	return false


func _has_job_for(state: MatchState, faction_id: String, cell: Vector2i) -> bool:
	for job in state.jobs.values():
		if job.faction_id == faction_id and job.target_cell == cell and job.status in ["open", "claimed"]:
			return true
	return false
