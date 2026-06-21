class_name MatchController
extends Node2D

const MatchStateScript = preload("res://scripts/sim/match_state.gd")
const BurnMapGeneratorScript = preload("res://scripts/map/burn_map_generator.gd")
const SurveyPatternScript = preload("res://scripts/sim/survey_pattern.gd")
const SurveyGeometryServiceScript = preload("res://scripts/sim/survey_geometry_service.gd")
const HearthCaptureScript = preload("res://scripts/sim/hearth_capture.gd")
const OrderProcessorScript = preload("res://scripts/sim/order_processor.gd")
const HippieBrainScript = preload("res://scripts/sim/hippie_brain.gd")
const CommandModelScript = preload("res://scripts/ui/command_model.gd")
const ContentLoaderScript = preload("res://scripts/sim/content_loader.gd")
const ChakraRitualScript = preload("res://scripts/sim/chakra_ritual.gd")
const CrystalInstabilityScript = preload("res://scripts/sim/crystal_instability.gd")
const NPCPlannerScript = preload("res://scripts/ai/npc_vexillomancer_planner.gd")
const NPCStrategyProfileScript = preload("res://scripts/ai/npc_strategy_profile.gd")

@onready var pattern_overlay: PatternOverlay = %PatternOverlay
@onready var selection_controller: SelectionController = %SelectionController
@onready var hearth_capture_hud: HearthCaptureHUD = %HearthCaptureHUD
@onready var debug_overlay: DebugOverlay = %DebugOverlay

var state: MatchState
var burn_map: BurnMapGenerator
var player_pattern: SurveyPattern
var faction_patterns: Dictionary = {}
var geometry: SurveyGeometryService = SurveyGeometryServiceScript.new()
var capture: HearthCapture = HearthCaptureScript.new()
var order_processor: OrderProcessor = OrderProcessorScript.new()
var hippie_brain: HippieBrain = HippieBrainScript.new()
var command_model: CommandModel = CommandModelScript.new()
var content_loader: ContentLoader = ContentLoaderScript.new()
var building_catalog: BuildingCatalog
var order_history: Array[Dictionary] = []
var rendered_entities: Dictionary = {}
var ui_state: Dictionary = {
	"buildings": {},
	"drugs": [],
	"abilities": {},
	"match_end_visible": false,
	"winner": "",
}
var vexillomancer_cells: Dictionary = {}
var camera_cell: Vector2i = Vector2i.ZERO
var fixture_rival_hearth_cell: Vector2i = Vector2i(14, 10)
var current_capture_state: Dictionary = {
	"state": "safe",
	"attacker_faction_id": "",
	"pressure": 0.0,
}

func _ready() -> void:
	if state == null:
		setup_fixture(GameConstants.DEFAULT_MATCH_SEED)


func setup_fixture(match_seed: String) -> void:
	state = MatchStateScript.new_default(match_seed)
	burn_map = BurnMapGeneratorScript.new().generate(match_seed)
	burn_map.apply_to_match_state(state)
	building_catalog = content_loader.load_building_catalog()
	player_pattern = SurveyPatternScript.from_cells("player", [
		fixture_rival_hearth_cell + Vector2i(-2, -2),
		fixture_rival_hearth_cell + Vector2i(2, -2),
		fixture_rival_hearth_cell + Vector2i(2, 2),
		fixture_rival_hearth_cell + Vector2i(-2, 2),
	])
	faction_patterns = {"player": player_pattern}
	_setup_vexillomancers()
	camera_cell = state.camps["camp_player"].cell
	current_capture_state = {
		"state": "safe",
		"attacker_faction_id": "",
		"pressure": 0.0,
	}
	_refresh_pattern_overlay()
	_render_fixture_entities()


func setup_generated_match(match_seed: String) -> void:
	state = MatchStateScript.new_default(match_seed)
	burn_map = BurnMapGeneratorScript.new().generate(match_seed)
	burn_map.apply_to_match_state(state)
	building_catalog = content_loader.load_building_catalog()
	faction_patterns.clear()
	for faction_id in state.factions.keys():
		faction_patterns[faction_id] = burn_map.pattern_for_faction(faction_id)
	player_pattern = faction_patterns["player"]
	_setup_vexillomancers()
	camera_cell = state.camps["camp_player"].cell
	current_capture_state = {
		"state": "safe",
		"attacker_faction_id": "",
		"pressure": 0.0,
	}
	_refresh_pattern_overlay()
	_render_fixture_entities()
	hearth_capture_hud.render_state(current_capture_state)
	debug_overlay.render_from(state.snapshot())


func claim_player_flag() -> String:
	return state.claim_inventory_flag("player", "vex_player")


func place_player_flag(flag_id: String, target_cell: Vector2i) -> Dictionary:
	var order := command_model.direct_place_order(
		"direct_place_%d" % (order_history.size() + 1),
		state.tick + 1,
		"player",
		"vex_player",
		flag_id,
		target_cell
	)
	return submit_order(order)


func issue_survey_command(target_cell: Vector2i, attention: int = 2) -> Dictionary:
	var order := command_model.survey_order(
		"survey_%d" % (order_history.size() + 1),
		state.tick + 1,
		"player",
		"vex_player",
		target_cell,
		attention
	)
	return submit_order(order)


func pickup_flag_for_intervention(flag_id: String) -> Dictionary:
	var order := {
		"id": "direct_pickup_%d" % (order_history.size() + 1),
		"tick": state.tick + 1,
		"actor_id": "vex_player",
		"faction_id": "player",
		"type": "pickup_flag",
		"payload": {"flag_id": flag_id},
	}
	return submit_order(order)


func submit_order(order: Dictionary) -> Dictionary:
	var result: Dictionary = order_processor.apply_order(state, order)
	if result.ok:
		order_history.append(order.duplicate(true))
	_refresh_pattern_overlay()
	return result


func advance_ticks(count: int) -> void:
	for _index in range(count):
		state.tick += 1
		hippie_brain.tick_faction(state, "player", state.tick)
		for faction_id in ["rival_surveyor", "rival_brewer", "rival_warden"]:
			var planner: NPCVexillomancerPlanner = NPCPlannerScript.new(NPCStrategyProfileScript.default_for(faction_id))
			for order in planner.plan_tick(state, burn_map, faction_id, state.tick):
				order_processor.apply_order(state, order)
			hippie_brain.tick_faction(state, faction_id, state.tick)
		_refresh_capture()
		_refresh_pattern_overlay()
		refresh_match_end()


func set_camera_cell(cell: Vector2i) -> void:
	camera_cell = cell


func select_vexillomancer(faction_id: String) -> void:
	selection_controller.select("vex_%s" % faction_id if faction_id != "player" else "vex_player")


func move_selected_vexillomancer(cell: Vector2i) -> void:
	if selection_controller.selected_id == "":
		return
	var faction_id := "player" if selection_controller.selected_id == "vex_player" else selection_controller.selected_id.trim_prefix("vex_")
	vexillomancer_cells[faction_id] = cell
	state.emit_event("vexillomancer_moved", state.tick, {"faction_id": faction_id, "cell": cell})


func place_building_from_ui(building_id: String, cell: Vector2i) -> Dictionary:
	if not burn_map.is_in_bounds(cell) or not burn_map.cell_at(cell).buildable:
		return {"ok": false, "error": "invalid_build_site"}
	var result: Dictionary = building_catalog.place_building(state, "player", building_id, cell)
	if result.ok:
		ui_state.buildings[result.building_id] = state.buildings[result.building_id].to_dict()
	return result


func damage_building_for_ui(building_id: String, amount: int) -> Dictionary:
	var result: Dictionary = building_catalog.damage_building(state, building_id, amount)
	if result.ok:
		ui_state.buildings[building_id] = state.buildings[building_id].to_dict()
	return result


func repair_building_for_ui(building_id: String, amount: int) -> Dictionary:
	var result: Dictionary = building_catalog.repair_building(state, building_id, amount)
	if result.ok:
		ui_state.buildings[building_id] = state.buildings[building_id].to_dict()
	return result


func use_drug_from_ui(drug_id: String) -> Dictionary:
	var drugs := content_loader.load_drugs()
	if not drugs.has(drug_id):
		return {"ok": false, "error": "unknown_drug"}
	var result: Dictionary = drugs[drug_id].use_on_faction(state, "player", state.tick)
	if result.ok:
		ui_state.drugs = state.factions["player"].active_drugs.duplicate(true)
	return result


func unlock_ability_via_ritual(ability_id: String) -> Dictionary:
	state.factions["player"].ritual = maxi(state.factions["player"].ritual, 3)
	var result: Dictionary = ChakraRitualScript.new().complete(state, "player", ability_id, 1, state.tick)
	if result.ok:
		ui_state.abilities[ability_id] = {"unlocked": true, "cooldown_until": 0}
	return result


func use_ability_from_ui(ability_id: String, target_cell: Vector2i) -> Dictionary:
	var abilities := content_loader.load_abilities()
	if not abilities.has(ability_id):
		return {"ok": false, "error": "unknown_ability"}
	var result: Dictionary = abilities[ability_id].apply(state, "player", target_cell, state.tick)
	if result.ok:
		ui_state.abilities[ability_id] = {
			"unlocked": true,
			"cooldown_until": state.factions["player"].ability_cooldowns[ability_id],
		}
	return result


func trigger_instability_fixture() -> void:
	var player := SurveyPatternScript.from_cells("player", [Vector2i(2, 2), Vector2i(8, 2), Vector2i(8, 8), Vector2i(2, 8)])
	var rival := SurveyPatternScript.from_cells("rival_surveyor", [Vector2i(5, 5), Vector2i(11, 5), Vector2i(11, 11), Vector2i(5, 11)])
	for index in range(player.vertices.size()):
		player.vertices[index].fulfilled_by_flag_id = "player_flag_%d" % index
		rival.vertices[index].fulfilled_by_flag_id = "rival_flag_%d" % index
	var events: Array[Dictionary] = CrystalInstabilityScript.new().update([player, rival], geometry, state.tick)
	pattern_overlay.render_from(player_pattern, current_capture_state, events)
	hearth_capture_hud.render_state(current_capture_state)


func refresh_match_end() -> void:
	var winner := state.winning_faction_id()
	ui_state.match_end_visible = winner != ""
	ui_state.winner = winner


func _refresh_pattern_overlay() -> void:
	geometry.refresh_pattern(player_pattern, state.flags)
	pattern_overlay.render_from(player_pattern, current_capture_state)
	hearth_capture_hud.render_state(current_capture_state)
	debug_overlay.render_from(state.snapshot())


func _refresh_capture() -> void:
	current_capture_state = capture.update_hearth(
		"hearth_rival_surveyor",
		fixture_rival_hearth_cell,
		"rival_surveyor",
		[player_pattern],
		geometry,
		0,
		state.tick
	)


func _render_fixture_entities() -> void:
	rendered_entities = {
		"map_cells": burn_map.cells.size(),
		"factions": state.factions.size(),
		"hippies": state.hippies.size(),
		"rival_hearth": fixture_rival_hearth_cell,
	}


func _setup_vexillomancers() -> void:
	vexillomancer_cells.clear()
	for faction_id in state.factions.keys():
		var camp_id := "camp_%s" % faction_id
		if state.camps.has(camp_id):
			vexillomancer_cells[faction_id] = state.camps[camp_id].cell
