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

@onready var pattern_overlay: PatternOverlay = %PatternOverlay
@onready var selection_controller: SelectionController = %SelectionController

var state: MatchState
var burn_map: BurnMapGenerator
var player_pattern: SurveyPattern
var geometry: SurveyGeometryService = SurveyGeometryServiceScript.new()
var capture: HearthCapture = HearthCaptureScript.new()
var order_processor: OrderProcessor = OrderProcessorScript.new()
var hippie_brain: HippieBrain = HippieBrainScript.new()
var command_model: CommandModel = CommandModelScript.new()
var order_history: Array[Dictionary] = []
var rendered_entities: Dictionary = {}
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
	player_pattern = SurveyPatternScript.from_cells("player", [
		fixture_rival_hearth_cell + Vector2i(-2, -2),
		fixture_rival_hearth_cell + Vector2i(2, -2),
		fixture_rival_hearth_cell + Vector2i(2, 2),
		fixture_rival_hearth_cell + Vector2i(-2, 2),
	])
	camera_cell = state.camps["camp_player"].cell
	current_capture_state = {
		"state": "safe",
		"attacker_faction_id": "",
		"pressure": 0.0,
	}
	_refresh_pattern_overlay()
	_render_fixture_entities()


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
		_refresh_capture()
		_refresh_pattern_overlay()


func set_camera_cell(cell: Vector2i) -> void:
	camera_cell = cell


func _refresh_pattern_overlay() -> void:
	geometry.refresh_pattern(player_pattern, state.flags)
	pattern_overlay.render_from(player_pattern, current_capture_state)


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
