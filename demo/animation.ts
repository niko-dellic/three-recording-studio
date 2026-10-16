export const animationState = {
  definitionVersion: "0.4.0",
  revisionHistory: ["bunny-camera-v3"],
  sheetsById: {
    Scene: {
      staticOverrides: { byObject: {} },
      sequence: {
        type: "PositionalSequence",
        length: 6,
        subUnitsPerUnit: 30,
        tracksByObject: {
          "Recording camera": {
            trackIdByPropPath: { '["angle"]': "angle" },
            trackData: {
              angle: {
                type: "BasicKeyframedTrack",
                keyframes: [0, Math.PI, Math.PI * 2].map((value, index) => ({
                  id: `camera${index}`,
                  position: index * 3,
                  value,
                  handles: [0.5, 0.5, 0.5, 0.5],
                  connectedRight: index < 2,
                })),
              },
            },
          },
          "Clipping plane": {
            trackIdByPropPath: { '["height"]': "height" },
            trackData: {
              height: {
                type: "BasicKeyframedTrack",
                keyframes: [1.35, -1.15, 1.35].map((value, index) => ({
                  id: `h${index}`,
                  position: index * 3,
                  value,
                  handles: [0.5, 0.5, 0.5, 0.5],
                  connectedRight: index < 2,
                })),
              },
            },
          },
        },
      },
    },
  },
};
