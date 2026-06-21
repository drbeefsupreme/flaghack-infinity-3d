class_name ContentLoader
extends RefCounted

const BUILDING_PATHS: Array[String] = [
	"res://resources/buildings/flag_workshop.tres",
	"res://resources/buildings/recruitment_circle.tres",
	"res://resources/buildings/hearth_ward.tres",
	"res://resources/buildings/drug_lab.tres",
]

const DRUG_PATHS: Array[String] = [
	"res://resources/drugs/saffron.tres",
	"res://resources/drugs/luminous_dust.tres",
	"res://resources/drugs/acid_cop_vision.tres",
]

const ABILITY_PATHS: Array[String] = [
	"res://resources/abilities/priority_beacon.tres",
	"res://resources/abilities/stabilize_zone.tres",
	"res://resources/abilities/forced_march.tres",
]

func load_building_catalog() -> BuildingCatalog:
	return BuildingCatalog.new().load_from_paths(BUILDING_PATHS)


func load_drugs() -> Dictionary:
	return _load_resources(DRUG_PATHS)


func load_abilities() -> Dictionary:
	return _load_resources(ABILITY_PATHS)


func validate_runtime_definition(definition: Dictionary, required_fields: Array[String]) -> Array[String]:
	var missing: Array[String] = []
	for field in required_fields:
		if not definition.has(field) or str(definition[field]) == "":
			missing.append(field)
	return missing


func _load_resources(paths: Array[String]) -> Dictionary:
	var result := {}
	for path in paths:
		var resource = load(path)
		result[resource.id] = resource
	return result
