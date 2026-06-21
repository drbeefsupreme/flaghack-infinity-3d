extends Node2D

var rendered_cells: int = 0
var last_summary_hash: String = ""

func render_from_map(burn_map: BurnMapGenerator) -> void:
	rendered_cells = burn_map.cells.size()
	last_summary_hash = burn_map.summary_hash()
