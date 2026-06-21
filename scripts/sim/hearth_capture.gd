class_name HearthCapture
extends RefCounted

var capture_threshold: float = 10.0
var base_pressure_rate: float = 1.0
var disruption_rate: float = 0.35
var pressures: Dictionary = {}
var hearth_states: Dictionary = {}

func update_hearth(
	hearth_id: String,
	hearth_cell: Vector2i,
	owner_faction_id: String,
	patterns: Array,
	geometry: SurveyGeometryService,
	disruption: int,
	event_tick: int
) -> Dictionary:
	var containing: Array = []
	for pattern: SurveyPattern in patterns:
		if pattern.faction_id != owner_faction_id and geometry.hearth_is_contained(pattern, hearth_cell):
			containing.append(pattern)

	if containing.is_empty():
		hearth_states[hearth_id] = _state("safe", "", 0.0, event_tick)
		return hearth_states[hearth_id]

	for pattern: SurveyPattern in containing:
		var current := _pressure(hearth_id, pattern.faction_id)
		current = maxf(0.0, current + base_pressure_rate - disruption * disruption_rate)
		set_pressure(hearth_id, pattern.faction_id, current)

	var winner := _highest_pressure(hearth_id, containing)
	var winning_pressure := _pressure(hearth_id, winner.faction_id)
	var state_name := "contained"
	if disruption > 0 and winning_pressure < capture_threshold:
		state_name = "contested"
	if winning_pressure >= capture_threshold:
		state_name = "overwritten"

	hearth_states[hearth_id] = _state(state_name, winner.faction_id, winning_pressure, event_tick)
	return hearth_states[hearth_id]


func set_pressure(hearth_id: String, faction_id: String, pressure: float) -> void:
	if not pressures.has(hearth_id):
		pressures[hearth_id] = {}
	pressures[hearth_id][faction_id] = pressure


func _pressure(hearth_id: String, faction_id: String) -> float:
	if not pressures.has(hearth_id):
		return 0.0
	return float(pressures[hearth_id].get(faction_id, 0.0))


func _highest_pressure(hearth_id: String, patterns: Array) -> SurveyPattern:
	var winner: SurveyPattern = patterns[0]
	var best_pressure := _pressure(hearth_id, winner.faction_id)
	for pattern: SurveyPattern in patterns:
		var pressure := _pressure(hearth_id, pattern.faction_id)
		if pressure > best_pressure:
			winner = pattern
			best_pressure = pressure
	return winner


func _state(state_name: String, attacker_faction_id: String, pressure: float, event_tick: int) -> Dictionary:
	return {
		"state": state_name,
		"attacker_faction_id": attacker_faction_id,
		"pressure": pressure,
		"tick": event_tick,
	}
