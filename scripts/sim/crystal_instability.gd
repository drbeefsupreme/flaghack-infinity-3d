class_name CrystalInstability
extends RefCounted

var active_zones: Array[Dictionary] = []
var decay_per_tick: float = 0.35

func update(patterns: Array, geometry: SurveyGeometryService, event_tick: int) -> Array[Dictionary]:
	var events: Array[Dictionary] = []
	var next_zones: Array[Dictionary] = []

	for i in range(patterns.size()):
		for j in range(i + 1, patterns.size()):
			var a: SurveyPattern = patterns[i]
			var b: SurveyPattern = patterns[j]
			if a.faction_id == b.faction_id:
				continue
			var overlap := geometry.overlap_region(a, b)
			if overlap.is_empty():
				continue
			var intensity := clampf(float(overlap.cells.size()) / 25.0, 0.05, 1.0)
			var event := {
				"type": "crystal_instability",
				"tick": event_tick,
				"factions": overlap.factions,
				"cells": overlap.cells,
				"intensity": intensity,
			}
			events.append(event)
			next_zones.append(event)

	for zone in active_zones:
		var decayed := zone.duplicate(true)
		decayed.intensity = maxf(0.0, float(decayed.intensity) - decay_per_tick)
		if decayed.intensity > 0.0:
			next_zones.append(decayed)

	active_zones = next_zones
	return events


func work_modifier_for_cell(cell: Vector2i) -> float:
	var modifier := 0.0
	for zone in active_zones:
		for zone_cell: Vector2i in zone.cells:
			if zone_cell == cell:
				modifier += float(zone.intensity)
	return clampf(modifier, 0.0, 1.0)


func capture_pressure_modifier_for_cell(cell: Vector2i) -> float:
	return work_modifier_for_cell(cell) * 0.5
