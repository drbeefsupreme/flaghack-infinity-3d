class_name StartingCampPlacer
extends RefCounted

func place(width: int, height: int) -> Dictionary:
	return {
		"player": Vector2i(4, 4),
		"rival_surveyor": Vector2i(width - 5, 4),
		"rival_brewer": Vector2i(4, height - 5),
		"rival_warden": Vector2i(width - 5, height - 5),
	}
