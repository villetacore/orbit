package store

import (
	"net/url"
	"strings"
)

// DemoServices is the example catalog used with ORBIT_SEED_DEMO=true.
func DemoServices(keycloakURL, realm, adminRole string) []ServiceInput {
	kc := strings.TrimRight(keycloakURL, "/")
	r := url.PathEscape(realm)
	return []ServiceInput{
		{
			Slug: "account-console", Name: "Аккаунт Keycloak", Category: "Безопасность", Status: StatusActive,
			Description: "Пароль, двухфакторная аутентификация, устройства и активные сессии.",
			URL:         kc + "/realms/" + r + "/account", SortOrder: 10,
		},
		{
			Slug: "wiki", Name: "База знаний", Category: "Документы", Status: StatusActive,
			Description: "Корпоративная wiki: регламенты, онбординг и документация.",
			URL:         "https://wiki.example.com", SortOrder: 20,
		},
		{
			Slug: "git", Name: "Git", Category: "Разработка", Status: StatusActive,
			Description:   "Репозитории, code review и CI.",
			URL:           "https://git.example.com", SortOrder: 30,
			RequiredRoles: []string{"developer"},
		},
		{
			Slug: "hr", Name: "HR-портал", Category: "Сотрудникам", Status: StatusMaintenance,
			Description: "Отпуска, справки и кадровые заявки.",
			URL:         "https://hr.example.com", SortOrder: 40,
		},
		{
			Slug: "keycloak-admin", Name: "Консоль Keycloak", Category: "Администрирование", Status: StatusActive,
			Description:   "Управление пользователями, ролями и клиентами realm.",
			URL:           kc + "/admin/" + r + "/console/", SortOrder: 90,
			RequiredRoles: []string{adminRole},
		},
	}
}
