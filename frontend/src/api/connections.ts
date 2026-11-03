import { endpoints } from "@enterprise/contracts";
import { endpoint } from "./endpoint";

export const connectionsApi = {
  resources: endpoint(endpoints.Connections_resources),
  locations: endpoint(endpoints.Connections_locations),
  contact: endpoint(endpoints.Connections_contact),
  dictionary: endpoint(endpoints.Connections_dictionary),
  favorites: endpoint(endpoints.Connections_favorites),
  profileFavorites: endpoint(endpoints.Connections_profileFavorites),
  addFavorite: endpoint(endpoints.Connections_addFavorite),
  removeFavorite: endpoint(endpoints.Connections_removeFavorite),
  addProfileFavorite: endpoint(endpoints.Connections_addProfileFavorite),
  removeProfileFavorite: endpoint(endpoints.Connections_removeProfileFavorite),
};
