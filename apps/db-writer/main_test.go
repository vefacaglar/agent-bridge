package main

import (
	"database/sql"
	"path/filepath"
	"testing"

	_ "modernc.org/sqlite"
)

func openTestDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "locagens.db"))
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	if err := initDB(db); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func TestExecuteRunAndMessageWrites(t *testing.T) {
	db := openTestDB(t)

	_, err := execute(db, request{
		ID: "1",
		Op: "run.create",
		Args: map[string]interface{}{
			"run": map[string]interface{}{
				"id":                  "run-1",
				"title":               "Title",
				"task":                "Task",
				"projectPath":         "/tmp/project",
				"projectName":         "project",
				"status":              "created",
				"providerId":          "provider",
				"providerDisplayName": "Provider",
				"model":               "model",
				"createdAt":           "2026-01-01T00:00:00Z",
				"updatedAt":           "2026-01-01T00:00:00Z",
			},
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	_, err = execute(db, request{
		ID: "2",
		Op: "message.create",
		Args: map[string]interface{}{
			"message": map[string]interface{}{
				"id":        "msg-1",
				"runId":     "run-1",
				"role":      "assistant",
				"content":   "hello",
				"createdAt": "2026-01-01T00:00:01Z",
			},
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	var status, lastActive string
	if err := db.QueryRow("SELECT status, last_active_at FROM runs WHERE id = ?", "run-1").Scan(&status, &lastActive); err != nil {
		t.Fatal(err)
	}
	if status != "created" || lastActive != "2026-01-01T00:00:01Z" {
		t.Fatalf("unexpected run row: status=%s lastActive=%s", status, lastActive)
	}
}

func TestExecuteMemoryWrites(t *testing.T) {
	db := openTestDB(t)

	result, err := execute(db, request{
		ID: "1",
		Op: "memory.create",
		Args: map[string]interface{}{
			"scope":       "project",
			"projectPath": "/tmp/project",
			"category":    "project",
			"content":     "Remember this",
			"now":         "2026-01-01T00:00:00Z",
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	id := result.(map[string]interface{})["lastInsertRowid"].(int64)

	_, err = execute(db, request{
		ID: "2",
		Op: "memory.update",
		Args: map[string]interface{}{
			"id":      float64(id),
			"content": "Updated",
			"now":     "2026-01-01T00:00:01Z",
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	var content string
	if err := db.QueryRow("SELECT content FROM memory WHERE id = ?", id).Scan(&content); err != nil {
		t.Fatal(err)
	}
	if content != "Updated" {
		t.Fatalf("unexpected memory content: %s", content)
	}
}
