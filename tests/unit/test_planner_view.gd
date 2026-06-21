extends GutTest

const MatchState = preload("res://scripts/sim/match_state.gd")
const PlannerView = preload("res://scripts/ai/planner_view.gd")

func test_planner_view_exposes_restricted_snapshot_without_debug_truth() -> void:
	var state = MatchState.new_default("planner-seed")
	var view: Dictionary = PlannerView.new().from_state(state, "rival_surveyor")

	assert_eq(view.faction_id, "rival_surveyor")
	assert_true(view.has("own_camps"))
	assert_true(view.has("visible_buildings"))
	assert_false(view.has("next_ids"))
	assert_false(view.has("hearth_owners"))
	assert_false(view.has("events"))


func test_planner_view_hides_disabled_raid_targets() -> void:
	var state = MatchState.new_default("planner-seed")
	var building_id: String = state.spawn_building("player", "flag_workshop", Vector2i(5, 5))
	state.buildings[building_id].disabled = true

	var view: Dictionary = PlannerView.new().from_state(state, "rival_surveyor")

	assert_true(view.visible_buildings.is_empty())
