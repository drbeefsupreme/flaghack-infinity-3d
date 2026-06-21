class_name LoreTerms
extends Resource

@export var labels: Dictionary = {}
@export var forbidden_terms: Array[String] = ["quasicrystal", "Penrose", "aperiodic"]

func label(key: String) -> String:
	return labels.get(key, key)


func contains_forbidden_terms(text: String) -> bool:
	var lower := text.to_lower()
	for forbidden in forbidden_terms:
		if lower.contains(forbidden.to_lower()):
			return true
	return false
