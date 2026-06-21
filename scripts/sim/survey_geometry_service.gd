class_name SurveyGeometryService
extends RefCounted

func cell_to_scene(cell: Vector2i) -> Vector2:
	return GameConstants.cell_to_world(cell)


func scene_to_cell(world_position: Vector2) -> Vector2i:
	return GameConstants.world_to_cell(world_position)


func refresh_pattern(pattern: SurveyPattern, flags: Dictionary) -> void:
	for vertex: PatternVertex in pattern.vertices:
		vertex.fulfilled_by_flag_id = ""
		for flag_id in flags.keys():
			var flag: FlagState = flags[flag_id]
			if flag.cell == vertex.cell and flag.carried_by == "":
				vertex.fulfilled_by_flag_id = flag_id
				break


func closed_region(pattern: SurveyPattern) -> Dictionary:
	if not pattern.is_closed():
		return {}
	var bounds := pattern.bounds()
	if bounds.is_empty():
		return {}
	var min_cell: Vector2i = bounds["min"]
	var max_cell: Vector2i = bounds["max"]
	var cells: Array[Vector2i] = []
	for x in range(min_cell.x, max_cell.x + 1):
		for y in range(min_cell.y, max_cell.y + 1):
			cells.append(Vector2i(x, y))
	return {
		"faction_id": pattern.faction_id,
		"min": min_cell,
		"max": max_cell,
		"cells": cells,
	}


func hearth_is_contained(pattern: SurveyPattern, hearth_cell: Vector2i) -> bool:
	var region := closed_region(pattern)
	if region.is_empty():
		return false
	var min_cell: Vector2i = region["min"]
	var max_cell: Vector2i = region["max"]
	return hearth_cell.x >= min_cell.x and hearth_cell.x <= max_cell.x and hearth_cell.y >= min_cell.y and hearth_cell.y <= max_cell.y


func overlap_region(a: SurveyPattern, b: SurveyPattern) -> Dictionary:
	var a_region := closed_region(a)
	var b_region := closed_region(b)
	if a_region.is_empty() or b_region.is_empty():
		return {}
	var min_cell := Vector2i(
		maxi(a_region["min"].x, b_region["min"].x),
		maxi(a_region["min"].y, b_region["min"].y)
	)
	var max_cell := Vector2i(
		mini(a_region["max"].x, b_region["max"].x),
		mini(a_region["max"].y, b_region["max"].y)
	)
	if min_cell.x > max_cell.x or min_cell.y > max_cell.y:
		return {}

	var cells: Array[Vector2i] = []
	for x in range(min_cell.x, max_cell.x + 1):
		for y in range(min_cell.y, max_cell.y + 1):
			cells.append(Vector2i(x, y))
	return {
		"factions": [a.faction_id, b.faction_id],
		"min": min_cell,
		"max": max_cell,
		"cells": cells,
	}


func find_vertex_for_cell(pattern: SurveyPattern, cell: Vector2i) -> PatternVertex:
	for vertex: PatternVertex in pattern.vertices:
		if vertex.cell == cell:
			return vertex
	return null
