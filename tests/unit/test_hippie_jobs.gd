extends GutTest

const MatchState = preload("res://scripts/sim/match_state.gd")
const JobAssignment = preload("res://scripts/sim/job_assignment.gd")
const HippieBrain = preload("res://scripts/sim/hippie_brain.gd")
const RaidOrder = preload("res://scripts/sim/raid_order.gd")

func test_hippie_claims_survey_job_and_places_flag() -> void:
	var state = MatchState.new_default("job-seed")
	state.create_job("player", "survey", Vector2i(7, 7), 2, 1)
	var hippie_id: String = state.factions["player"].hippie_ids[0]
	var brain = HippieBrain.new()

	var result: Dictionary = brain.tick_hippie(state, hippie_id, 2)

	assert_eq(result.status, "completed")
	assert_eq(state.jobs.values()[0].status, "complete")
	assert_eq(_flag_at(state, Vector2i(7, 7)).controlling_faction_id, "player")


func test_two_hippies_cannot_claim_the_same_job() -> void:
	var state = MatchState.new_default("job-seed")
	var extra_hippie_id: String = state.spawn_hippie("player", Vector2i(5, 5))
	state.create_job("player", "survey", Vector2i(7, 7), 2, 1)
	var assignment = JobAssignment.new()

	var first: String = assignment.claim_next_job(state, state.factions["player"].hippie_ids[0])
	var second: String = assignment.claim_next_job(state, extra_hippie_id)

	assert_ne(first, "")
	assert_eq(second, "")
	assert_eq(state.jobs[first].claimed_by, state.factions["player"].hippie_ids[0])


func test_missing_flag_supply_leaves_recoverable_job_state() -> void:
	var state = MatchState.new_default("job-seed")
	state.factions["player"].flag_inventory = 0
	state.create_job("player", "survey", Vector2i(7, 7), 2, 1)
	var brain = HippieBrain.new()

	var result: Dictionary = brain.tick_hippie(state, state.factions["player"].hippie_ids[0], 2)

	assert_eq(result.status, "blocked_no_flag")
	assert_eq(state.jobs.values()[0].status, "blocked_no_flag")
	assert_eq(state.factions["player"].attention_available, 10)


func test_distracted_hippie_delays_job_without_losing_claim() -> void:
	var state = MatchState.new_default("job-seed")
	state.create_job("player", "survey", Vector2i(7, 7), 2, 1)
	var hippie_id: String = state.factions["player"].hippie_ids[0]
	state.hippies[hippie_id].distracted_ticks = 1
	var brain = HippieBrain.new()

	var result: Dictionary = brain.tick_hippie(state, hippie_id, 2)

	assert_eq(result.status, "delayed")
	assert_eq(state.hippies[hippie_id].job_id, state.jobs.keys()[0])


func test_raid_order_disrupts_building_through_simulation_state() -> void:
	var state = MatchState.new_default("raid-seed")
	var building_id: String = state.spawn_building("rival_surveyor", "flag_workshop", Vector2i(30, 4))
	var raid = RaidOrder.new()

	var result: Dictionary = raid.apply(state, "player", building_id, 3, 5)

	assert_true(result.ok)
	assert_lt(state.buildings[building_id].hp, state.buildings[building_id].max_hp)
	assert_eq(state.factions["player"].attention_available, 7)


func _flag_at(state, cell: Vector2i):
	for flag in state.flags.values():
		if flag.cell == cell:
			return flag
	return null
