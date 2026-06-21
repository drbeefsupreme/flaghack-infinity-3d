class_name SelectionController
extends Node

var selected_id: String = ""
var command_mode: String = ""

func select(entity_id: String) -> void:
	selected_id = entity_id


func enter_command_mode(mode: String) -> void:
	command_mode = mode


func cancel_command_mode() -> void:
	command_mode = ""
